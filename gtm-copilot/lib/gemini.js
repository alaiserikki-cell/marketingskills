// Thin REST client for the Gemini API (free tier). No SDK, so model/API drift is easy to handle.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let resolvedModel = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Supports several free-tier keys: GEMINI_API_KEYS=key1,key2,key3 (rotates on rate limits).
let keyIdx = 0;
const badKeys = new Set();
function keys() {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter((k) => k && !badKeys.has(k));
}
const key = () => keys()[keyIdx % keys().length];

export function hasGemini() {
  return keys().length > 0;
}

// Pick a model: env override, else the newest stable "flash" model the key can use.
export async function getModel() {
  if (resolvedModel) return resolvedModel;
  if (process.env.GEMINI_MODEL) return (resolvedModel = process.env.GEMINI_MODEL.trim());
  try {
    const res = await fetch(`${BASE}/models?pageSize=200&key=${key()}`);
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((n) => /^gemini-[\d.]+-flash$/.test(n) || /^gemini-[\d.]+-flash-latest$/.test(n));
    names.sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
    resolvedModel = names[0] || 'gemini-2.5-flash';
  } catch {
    resolvedModel = 'gemini-2.5-flash';
  }
  return resolvedModel;
}

function retryDelayMs(err) {
  const info = (err?.error?.details || []).find((d) => String(d['@type']).includes('RetryInfo'));
  const s = info?.retryDelay ? parseFloat(info.retryDelay) : 20;
  return Math.min(Math.max(s, 5), 65) * 1000;
}

/**
 * generate({ system, prompt, grounded, json, temperature })
 * grounded=true turns on Google Search grounding and returns the web sources Gemini used.
 * Returns { text, sources: [{title, uri}], queries: [] , model }
 */
export async function generate({ system = '', prompt, grounded = false, json = false, temperature = 0.4 }) {
  if (!hasGemini()) throw new Error('GEMINI_API_KEYS is not set. Add it to gtm-copilot/.env and restart.');
  const model = await getModel();
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (grounded) body.tools = [{ google_search: {} }];
  if (json && !grounded) body.generationConfig.responseMimeType = 'application/json';

  const maxAttempts = 3 + keys().length * 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status === 503 || res.status === 500) {
      if (attempt === maxAttempts - 1) throw new Error(`Gemini rate limit / overload (${res.status}) on all keys. Free tier allows a few requests per minute; wait a minute and retry.`);
      // Rotate to the next key first; only wait once every key has been tried.
      keyIdx++;
      if (keys().length === 1 || keyIdx % keys().length === 0) await sleep(retryDelayMs(data));
      continue;
    }
    if ((res.status === 400 || res.status === 401 || res.status === 403) && /API key/i.test(data?.error?.message || '') && keys().length > 1) {
      badKeys.add(key()); // invalid key: drop it and try the next one
      continue;
    }
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${data?.error?.message || 'unknown'}`);

    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    const gm = cand?.groundingMetadata || {};
    const seen = new Set();
    const sources = (gm.groundingChunks || [])
      .map((c) => c.web)
      .filter(Boolean)
      .filter((w) => (seen.has(w.uri) ? false : seen.add(w.uri)))
      .map((w) => ({ title: w.title || w.uri, uri: w.uri }));
    return { text, sources, queries: gm.webSearchQueries || [], model };
  }
}

// Ask for JSON and parse it robustly (strips code fences if the model adds them).
export async function generateJSON(opts) {
  const out = await generate({ ...opts, json: !opts.grounded });
  let t = out.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  try {
    return { ...out, data: JSON.parse(t) };
  } catch {
    throw new Error('Gemini returned malformed JSON. Try running again.');
  }
}
