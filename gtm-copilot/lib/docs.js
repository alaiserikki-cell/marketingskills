// Downloadable documents: one Markdown builder, exported as .md, .docx (here) or PDF (in the browser).
import { marked } from 'marked';
import htmlToDocx from 'html-to-docx';
import JSZip from 'jszip';
import * as db from './db.js';
import { creativePack } from './creative.js';

const day = () => new Date().toISOString().slice(0, 10);
const safe = (s = '') => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'document';
const pretty = (k = '') => k.replace(/^g_/, '').replace(/^skill_/, 'skill: ').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// what = "pack" | "creative" | "record-<id>"
export async function buildDoc(pid, what) {
  const p = await db.getProject(pid);
  if (!p) throw new Error('Project not found');
  if (what === 'creative') return { title: `${p.name} creative pack`, md: await creativePack(pid) };

  if (what.startsWith('record-')) {
    const r = await db.getRecord(Number(what.slice(7)));
    if (!r || r.project_id !== Number(pid)) throw new Error('Document not found');
    const name = r.kind === 'competitor' ? `${r.key} breakdown` : pretty(r.key);
    if (!r.data.text) throw new Error('This item has no document text');
    let md = `# ${p.name}: ${name}\n\n_Generated ${(r.data.generated_at || '').slice(0, 10) || day()}_\n\n${r.data.text}\n`;
    if (r.data.sources?.length) md += `\n## All sources searched\n${r.data.sources.map((s) => `- [${s.title}](${s.uri})`).join('\n')}\n`;
    return { title: `${p.name} ${name}`, md };
  }

  if (what !== 'pack') throw new Error('Unknown document');
  const recs = await db.listRecords(pid);
  const order = ['problem_statement', 'company_profile', 'market_research', 'competitor_landscape', 'ceo_answers_synthesis', 'community_listening', 'content_analysis', 'brand_strategy', 'expansion_plan', 'insight_doc', 'solution_doc', 'growth_playbook', 'deck_outline'];
  let md = `# ${p.name}: GTM research pack\n_Exported ${day()}_\n`;
  const facts = recs.filter((r) => r.kind === 'fact');
  if (facts.length) md += `\n## Verified facts\n${facts.map((f) => `- ${f.data.text} _(source: ${f.data.source})_`).join('\n')}\n`;
  const arts = recs.filter((r) => r.kind === 'artifact');
  const keys = [...order, ...arts.map((a) => a.key).filter((k) => !order.includes(k))];
  for (const key of keys) {
    const a = arts.find((r) => r.key === key);
    if (a?.data.text) md += `\n\n# ${pretty(key)}\n\n${a.data.text}\n`;
  }
  for (const c of recs.filter((r) => r.kind === 'competitor')) md += `\n\n# Competitor: ${c.key} (${c.data.group})\n\n${c.data.text}\n`;
  const qs = recs.filter((r) => r.kind === 'question');
  if (qs.length) md += `\n\n# Questions for the founders\n${qs.map((q) => `- **[${q.data.priority}] ${q.data.question}**\n  - Why: ${q.data.why}\n  - Answer: ${q.data.answer || '_(pending)_'}`).join('\n')}\n`;
  const ex = recs.filter((r) => r.kind === 'experiment');
  if (ex.length) md += `\n\n# Experiments\n${ex.map((e) => `## ${e.data.name} (${e.data.status})\n- Hypothesis: ${e.data.hypothesis}\n- Primary metric: ${e.data.primary_metric}\n- Iterations: ${(e.data.iterations || []).length}\n${e.data.review ? `\n${e.data.review}\n` : ''}`).join('\n')}\n`;
  return { title: `${p.name} GTM research pack`, md };
}

export const fileName = (title, ext) => `${safe(title)}_${day()}.${ext}`;

// Word: Markdown -> HTML -> .docx, with clickable links and bordered tables.
export async function toDocx({ title, md }) {
  const body = marked.parse(md)
    .replace(/<table>/g, '<table border="1" style="border-collapse:collapse;width:100%">')
    .replace(/<th>/g, '<th style="background-color:#235e52;color:#ffffff;padding:4px">')
    .replace(/<td>/g, '<td style="padding:4px;vertical-align:top">')
    .replace(/<pre><code[^>]*>/g, '<pre style="font-family:Consolas">').replace(/<\/code><\/pre>/g, '</pre>');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
  const stored = await htmlToDocx(html, null, {
    title, creator: 'GTM Copilot', font: 'Calibri', fontSize: 21,
    table: { row: { cantSplit: true } }, footer: true, pageNumber: true,
    margins: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
  });
  // html-to-docx writes the zip uncompressed (~15x bigger); recompress so big packs fit Vercel's 4.5 MB limit.
  const zip = await JSZip.loadAsync(stored);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
