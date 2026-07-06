// Vercel serverless function — turns a transcript into structured task drafts via Sarvam-M
// (chat completions). Model is configurable via SARVAM_MODEL (default sarvam-105b).
//
// Request:  POST /api/extract   { transcript: string, recorded_at: ISO string }
// Response: { tasks: [...] }  (see SCHEMA in the prompt below)

export const config = { runtime: 'nodejs', maxDuration: 60 };

const MODEL = process.env.SARVAM_MODEL || 'sarvam-105b';

function buildSystemPrompt(recordedAt) {
  const d = new Date(recordedAt);
  const human = isNaN(d) ? recordedAt : d.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `You are a task-extraction engine for a voice-first task manager. The user recorded a spoken, rambling brain-dump; you receive its transcript. Extract every actionable task.

The recording was made at: ${recordedAt} (${human}).
Resolve ALL relative dates ("today", "tomorrow", "next Monday", "in two weeks", "end of the month") against THIS timestamp and output absolute ISO dates (YYYY-MM-DD).

Rules:
- Split distinct, unrelated tasks into separate items. Do NOT merge unrelated tasks.
- "owner" defaults to "You" unless the transcript clearly delegates the task to a named person.
- People mentioned as helpers/contacts ("ask Sam", "check with Priya") go in "collaborators" as free-text names. Never notify or link them; they are context only.
- Detect dependencies BETWEEN tasks in this same recording (sequencing / blocking language). Reference the other task by its exact "title".
- Provide a confidence from 0 to 1 for due_date, priority, owner, and an "confidence" overall score. Use LOW confidence (< 0.75) when the transcript is vague or you are guessing.
- "priority" is one of: "high", "medium", "low". Infer from urgency language; if unstated, use "medium" with low priority_confidence.
- If no actionable tasks are present, return {"tasks": []}.

Return ONLY valid JSON, no prose, matching exactly:
{
  "tasks": [
    {
      "title": "short imperative title",
      "description": "one short line of context, or empty string",
      "owner": "You",
      "owner_confidence": 0.0,
      "collaborators": ["Name"],
      "due_date": "YYYY-MM-DD or null",
      "due_label": "human label like 'Tomorrow · 7 Jul' or empty string",
      "due_confidence": 0.0,
      "priority": "high|medium|low",
      "priority_confidence": 0.0,
      "confidence": 0.0,
      "dependencies": [
        { "type": "blocked_by|blocks|related", "target_title": "exact title of another task above" }
      ]
    }
  ]
}`;
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
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const transcript = (body.transcript || '').trim();
    const recordedAt = body.recorded_at || new Date().toISOString();

    if (!transcript) {
      return res.status(400).json({ error: 'Empty transcript.' });
    }

    const upstream = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(recordedAt) },
          { role: 'user', content: transcript },
        ],
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Sarvam chat error', detail: data });
    }

    const content = data?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Model occasionally wraps JSON in prose — salvage the first {...} block.
      const match = content.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { tasks: [] };
    }
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];

    return res.status(200).json({ tasks: parsed.tasks, model: MODEL });
  } catch (err) {
    return res.status(500).json({ error: 'Extraction failed', detail: String(err) });
  }
}
