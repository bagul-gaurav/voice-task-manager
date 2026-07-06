# Voice Task Manager

Record a spoken, rambling brain-dump → it's transcribed with **Sarvam Saaras**, split into structured task drafts by **Sarvam-M**, and shown on a mandatory review screen where you confirm/edit before anything is saved. Single-user; tasks persist in the browser's `localStorage`.

This is the **Option A** architecture: a single static `index.html` frontend plus two tiny Vercel serverless functions that hold the API key and proxy to Sarvam (so the key is never exposed to the browser, and CORS is avoided).

## Structure

```
index.html          Whole app UI + logic (static, no build step)
api/transcribe.js   Proxy → Sarvam Saaras speech-to-text  (POST /api/transcribe)
api/extract.js      Proxy → Sarvam-M chat completions      (POST /api/extract)
vercel.json         Function config (maxDuration)
.env.example        Env var template
```

## How it works

1. **Record** — the browser captures mic audio with `MediaRecorder` in **~25-second WebM segments** (Sarvam's REST STT caps at ~30s per request). Soft nudge at 10 min, hard auto-stop at 60 min.
2. **Transcribe** — each segment is POSTed to `/api/transcribe`, which forwards it to Sarvam Saaras (`saaras:v3`, `mode=translate`). Transcripts are concatenated in order.
3. **Extract** — the full transcript + the recording's timestamp are POSTed to `/api/extract`. Sarvam-M returns JSON task drafts with per-field confidence, resolved absolute dates, collaborators, and dependency proposals.
4. **Review** — every task is shown for confirmation. Low-confidence fields (< 0.75) are highlighted; dependencies are proposals you Link/Dismiss; edit any field inline; discard individual tasks; "Confirm all" saves the batch.

## Setup

Requires the [Vercel CLI](https://vercel.com/docs/cli) and Node 18+.

```bash
npm i -g vercel

# 1. Add your key locally (do NOT commit it)
cp .env.example .env.local
#   then edit .env.local and paste your SARVAM_API_KEY

# 2. Run locally (serves index.html AND the /api functions)
vercel dev
```

> Note: opening `index.html` with a plain static server will NOT work — the `/api/*` calls need `vercel dev` (or a deployment) to run the serverless functions.

## Deploy

```bash
vercel            # first deploy (links the project)
vercel --prod     # production
```

Then set the environment variables in the Vercel dashboard (**Project → Settings → Environment Variables**):

| Variable | Required | Value |
|---|---|---|
| `SARVAM_API_KEY` | yes | your Sarvam subscription key (`sk_...`) |
| `SARVAM_MODEL` | no | `sarvam-105b` (default) or `sarvam-30b` |

Redeploy after adding env vars so the functions pick them up.

## Notes & limits

- **Storage is per-browser** (`localStorage`) — tasks don't sync across devices. Swapping to a hosted DB is a later step.
- **Long audio** is handled by client-side chunking into 25s segments; this scales to the 60-min cap but makes many STT calls. A future optimization is Sarvam's async Batch API (up to 2h) for very long recordings.
- **Duplicate detection is intentionally out of scope** for v1 (see the PRD).
- Sarvam is strongest on Indian English + Indic languages; validate transcription quality with your real users' speech.
