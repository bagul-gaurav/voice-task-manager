// Vercel serverless function — proxies a single audio segment to Sarvam Saaras STT.
// The browser never sees the API key; it lives in the SARVAM_API_KEY env var.
//
// Request:  POST /api/transcribe   body = raw audio bytes (Content-Type: audio/webm | audio/mp4 | ...)
// Response: { transcript, language_code, language_probability }
//
// Sarvam REST STT caps at ~30s of audio per request, so the client sends ~25s segments.

export const config = { runtime: 'nodejs', maxDuration: 60 };

async function readRawBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server misconfigured: SARVAM_API_KEY is not set.' });
  }

  try {
    const audio = await readRawBody(req);
    if (!audio || audio.length === 0) {
      return res.status(400).json({ error: 'Empty audio body.' });
    }

    const mime = req.headers['content-type'] || 'audio/webm';
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `segment.${ext}`);
    form.append('model', 'saaras:v3');
    form.append('mode', 'translate');        // Saaras translate -> English text
    form.append('language_code', 'unknown'); // auto-detect source language

    const upstream = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': key },
      body: form,
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Sarvam STT error', detail: data });
    }

    return res.status(200).json({
      transcript: data.transcript || '',
      language_code: data.language_code || null,
      language_probability: data.language_probability ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Transcription failed', detail: String(err) });
  }
}
