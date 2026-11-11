// Knowledge hub: a free stand-in for Think with Google (insights), Marketing Examples /
// Because of Marketing (campaign library), Exploding Topics (trends) and Similarweb (traffic).
// Free sources only: Gemini + Google Search grounding, Wikipedia pageviews API, Tranco list API.
import { generate, generateJSON } from './gemini.js';
import { systemFor } from './skills.js';
import * as db from './db.js';
import { buildContext, ROLE_ANALYST } from './modules.js';

const UA = { 'User-Agent': 'GTM-Copilot/0.2 (open-source student research tool)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// Step 1: grounded research in prose (this is what makes Gemini actually search and return sources).
// Step 2: turn ONLY that text into JSON (no new facts). Grounding can't be combined with JSON mode.
async function researchThenStructure({ skills, research, schema }) {
  const sys = systemFor(ROLE_ANALYST, skills);
  const r = await generate({ system: sys, prompt: `${research}

Write your findings as a markdown list. For every item give the source publication and date in brackets. Only include items you found in a source.`, grounded: true });
  if (!r.sources?.length) throw new Error('Search returned no sources this time, so nothing was saved. Try again or rephrase.');
  const j = await generateJSON({ system: 'You convert research notes into JSON. Use ONLY facts present in the notes. Never add facts, numbers or examples.', prompt: `NOTES:
${r.text}

${schema}` });
  const data = Array.isArray(j.data) ? j.data : Object.values(j.data).find(Array.isArray) || [];
  return { data, notes: r.text, sources: r.sources, model: r.model };
}

async function save(pid, type, topic, payload) {
  return db.addRecord(pid, 'kb', `${type}:${topic}`.slice(0, 180), { type, topic, ...payload, generated_at: now() });
}

// ---------- 1. Insights (Think with Google style) ----------
export async function runInsights(pid, topic) {
  if (!topic?.trim()) throw new Error('Enter a topic, e.g. "how Indians shop for used phones"');
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const out = await researchThenStructure({
    skills: ['customer-research', 'product-marketing'],
    research: `${ctx}

TASK: You are building a "Think with Google"-style insight board for ${project.name} on: "${topic}".
Search for 6-10 consumer and market insights about India. Prefer thinkwithgoogle.com, Google/Kantar/Bain/Redseer/KPMG/Nielsen/IAMAI reports, government data and reputable press. Only use numbers you found in a source; never estimate.`,
    schema: `Return a JSON array: [{"insight":"one-sentence headline insight","stat":"the number with unit, exactly as in the notes","publisher":"","date":"month/year","so_what":"what it means for ${project.name}, one sentence","motivation":"value|trust|discovery|convenience|circular|other"}]`,
  });
  return save(pid, 'insights', topic.trim(), { cards: out.data, notes: out.notes, sources: out.sources, model: out.model });
}

// ---------- 2. Campaign library (Marketing Examples / Because of Marketing style) ----------
export async function runLibrary(pid, topic) {
  if (!topic?.trim()) throw new Error('Enter a theme, e.g. "trust-building campaigns for used goods"');
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const out = await researchThenStructure({
    skills: ['reverse-engineer-marketing', 'marketing-ideas', 'marketing-psychology'],
    research: `${ctx}

TASK: Build a swipe file of 6-10 REAL marketing campaigns and growth moves on the theme "${topic}", in the style of marketingexamples.com and Because of Marketing: concrete breakdowns of what a brand did and why it worked.
Prefer Indian brands, then global ones. Search case-study sites (marketingexamples.com, becauseofmarketing, afaqs, exchange4media, Campaign India, brand blogs) and press. Only include campaigns you found a source for. Describe in your own words; do not copy text.`,
    schema: `Return a JSON array: [{"brand":"","campaign":"name or short description","year":"","channel":"Instagram|YouTube|Reddit|LinkedIn|TV|OOH|PR|Product|Community|Other","tactic":"what they did, 1-2 sentences","why_it_worked":"the principle, 1 sentence","result":"reported result, or 'not reported'","lesson":"how ${project.name} could adapt it, 1 sentence","motivation":"value|trust|discovery|convenience|circular|other"}]`,
  });
  return save(pid, 'library', topic.trim(), { cards: out.data, notes: out.notes, sources: out.sources, model: out.model });
}

// ---------- 3. Trends (Exploding Topics style) ----------
async function wikiTitle(term, lang = 'en') {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${encodeURIComponent(term)}`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.[1]?.[0] || null;
}

const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;

// Monthly Wikipedia page views for the last 24 full months, plus growth numbers the app computes.
export async function wikiTrend(term) {
  const title = await wikiTitle(term);
  if (!title) return { term, error: 'No Wikipedia article found' };
  const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  end.setUTCMonth(end.getUTCMonth() - 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 23);
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${ym(start)}/${ym(end)}`;
  let r = await fetch(u, { headers: UA });
  if (r.status === 429) { await wait(2000); r = await fetch(u, { headers: UA }); }
  if (!r.ok) return { term, title, error: `Wikipedia returned ${r.status}` };
  const items = (await r.json()).items || [];
  const series = items.map((i) => ({ month: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}`, views: i.views }));
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x.views, 0) / a.length : null);
  const last3 = avg(series.slice(-3));
  const prev3 = avg(series.slice(-6, -3));
  const yago3 = series.length >= 15 ? avg(series.slice(-15, -12)) : null;
  const pct = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 100) : null);
  return {
    term, title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    series, monthly_avg_last3: last3 && Math.round(last3), growth_yoy_pct: pct(last3, yago3), momentum_pct: pct(last3, prev3),
  };
}

export async function runTrends(pid, { topic, terms }) {
  let list = (terms || []).map((t) => String(t).trim()).filter(Boolean);
  let scout = null;
  if (topic?.trim()) {
    const { project, ctx } = await buildContext(pid, { include: 'basic' });
    const out = await researchThenStructure({
      skills: ['content-strategy'],
      research: `${ctx}

TASK: Like Exploding Topics, find 8 topics, products, brands or behaviours that are RISING in India and relevant to "${topic}" for ${project.name}. Use Google Search for evidence of growth (news, reports, launches) from the last 18 months.`,
      schema: `Return a JSON array: [{"term":"short name, phrased like a Wikipedia article title where possible","why_rising":"1 sentence with the evidence","evidence_date":"month/year","relevance":"why it matters to ${project.name}, 1 sentence"}]`,
    });
    scout = { items: out.data, sources: out.sources, model: out.model };
    list = [...list, ...scout.items.map((i) => i.term)];
  }
  if (!list.length) throw new Error('Enter a topic to scout, or terms to check.');
  const checks = [];
  for (const term of [...new Set(list)].slice(0, 15)) {
    try { checks.push(await wikiTrend(term)); } catch (e) { checks.push({ term, error: e.message }); }
    await wait(400);
  }
  return save(pid, 'trends', topic?.trim() || list.join(', '), { scout, checks, sources: scout?.sources || [] });
}

// ---------- 4. Traffic (Similarweb-style comparison via the free Tranco list) ----------
const cleanDomain = (d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export async function runTraffic(pid, domains) {
  const list = [...new Set((domains || []).map(cleanDomain).filter(Boolean))].slice(0, 12);
  if (!list.length) throw new Error('Enter domains, e.g. circlestore.in, olx.in, cashify.in');
  const rows = [];
  for (const d of list) {
    try {
      const get = () => fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(d)}`, { headers: UA });
      let r = await get();
      if (r.status === 429) { await wait(3000); r = await get(); }
      const ranks = r.ok ? (await r.json()).ranks || [] : [];
      const today = ranks[0]?.rank ?? null;
      const old = ranks[ranks.length - 1]?.rank ?? null;
      rows.push({ domain: d, rank: today, rank_date: ranks[0]?.date || null, rank_30d_ago: old, change: today && old ? old - today : null, series: ranks.slice().reverse() });
    } catch (e) {
      rows.push({ domain: d, error: e.message });
    }
    await wait(1100); // Tranco asks for ~1 request per second
  }
  rows.sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9));
  return save(pid, 'traffic', list.join(', '), { rows, sources: [{ title: 'Tranco list (research-grade top-1M site ranking)', uri: 'https://tranco-list.eu/' }] });
}

// Compact summary of the knowledge base for other modules' prompts.
export function kbContext(recs) {
  const kb = recs.filter((r) => r.kind === 'kb');
  if (!kb.length) return '';
  const lines = kb.map((r) => {
    const d = r.data;
    if (d.type === 'insights') return `Insights on "${d.topic}": ${d.cards.map((c) => `${c.insight} (${c.stat}; ${c.publisher}, ${c.date})`).join(' | ')}`;
    if (d.type === 'library') return `Campaign library "${d.topic}": ${d.cards.map((c) => `${c.brand} — ${c.campaign}: ${c.tactic}`).join(' | ')}`;
    if (d.type === 'trends') return `Trends "${d.topic}": ${d.checks.filter((c) => !c.error).map((c) => `${c.term} YoY ${c.growth_yoy_pct ?? '?'}%`).join(', ')}`;
    if (d.type === 'traffic') return `Tranco traffic ranks: ${d.rows.map((x) => `${x.domain} #${x.rank ?? 'not in top 1M'}`).join(', ')}`;
    return '';
  });
  return `\n## Knowledge hub (web-sourced, verify before quoting)\n${lines.join('\n').slice(0, 6000)}\n`;
}
