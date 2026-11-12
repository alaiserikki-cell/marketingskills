// Downloadable documents: one Markdown builder, exported as .md, .docx (here) or PDF (in the browser).
import { marked } from 'marked';
import htmlToDocx from 'html-to-docx';
import JSZip from 'jszip';
import * as db from './db.js';
import { creativePack } from './creative.js';
import { GROWTH_MODULES } from './growth.js';

const day = () => new Date().toISOString().slice(0, 10);
const safe = (s = '') => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'document';
const pretty = (k = '') => k.replace(/^g_/, '').replace(/^skill_/, 'skill: ').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const cell = (v = '') => String(v ?? '').replace(/\|/g, '/').replace(/\n+/g, ' ');
const num = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN'));
// Nest an artifact's own headings under its chapter heading.
const shift = (md = '', by = 1) => md.replace(/^(#{1,5}) /gm, (m, h) => `${'#'.repeat(Math.min(6, h.length + by))} `);
const artBlock = (recs, key, title) => {
  const a = recs.find((r) => r.kind === 'artifact' && r.key === key);
  return a?.data.text ? `\n## ${title}\n_Generated ${(a.data.generated_at || '').slice(0, 10)}_\n\n${shift(a.data.text)}\n` : '';
};
const table = (head, rows) => (rows.length ? `\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n` : '');
const srcLinks = (s = []) => s.map((x) => `[${x.site}](${x.url})`).join(' ');

// One chapter per app tab. Each returns markdown ('' when that tab has nothing yet).
export const SECTIONS = [
  ['setup', 'Company & verified facts', (p, recs) => {
    const facts = recs.filter((r) => r.kind === 'fact');
    return (p.description ? `\n${p.description}\n` : '') + (p.website ? `\nWebsite: ${p.website}\n` : '') + table(['Fact', 'Source'], facts.map((f) => [f.data.text, f.data.source]));
  }],
  ['questions', 'CEO questions & answers', (p, recs) => {
    const qs = recs.filter((r) => r.kind === 'question');
    const ps = recs.find((r) => r.kind === 'artifact' && r.key === 'problem_statement');
    return (ps?.data.text ? `\n**Problem in one sentence:** ${ps.data.text}\n` : '')
      + table(['Priority', 'Question', 'Why it matters', 'Answer'], qs.map((q) => [q.data.priority, q.data.question, q.data.why, q.data.answer || 'pending']))
      + artBlock(recs, 'ceo_answers_synthesis', 'What the answers change');
  }],
  ['company', 'Company profile', (p, recs) => artBlock(recs, 'company_profile', 'Company profile')],
  ['market', 'Market research', (p, recs) => artBlock(recs, 'market_research', 'Market research')],
  ['knowledge', 'Knowledge hub', (p, recs) => recs.filter((r) => r.kind === 'kb').map((r) => {
    const d = r.data;
    if (d.type === 'insights') return `\n## Consumer insights: ${d.topic}\n` + table(['Stat', 'Insight', 'Source', 'So what'], (d.cards || []).map((c) => [c.stat, c.insight, `${c.publisher}, ${c.date} ${srcLinks(c.sources)}`, c.so_what]));
    if (d.type === 'library') return `\n## Campaign library: ${d.topic}\n` + (d.cards || []).map((c) => `\n### ${c.brand}: ${c.campaign} (${c.year})\n- **What they did:** ${c.tactic}\n- **Why it worked:** ${c.why_it_worked}\n- **Result:** ${c.result}\n- **Lesson for ${p.name}:** ${c.lesson}\n- **Sources:** ${srcLinks(c.sources) || 'see the knowledge hub'}\n`).join('');
    if (d.type === 'trends') return `\n## Trends: ${d.topic}\n_Wikipedia monthly views measure attention, not searches. Compare topics with each other._\n`
      + table(['Topic', 'Avg views / month', 'Year on year', 'vs previous 3 months'], (d.checks || []).map((c) => [c.term, c.error || num(c.monthly_avg_last3), c.growth_yoy_pct == null ? '' : `${c.growth_yoy_pct}%`, c.momentum_pct == null ? '' : `${c.momentum_pct}%`]))
      + (d.scout ? table(['Topic', 'Why rising', 'Relevance'], d.scout.items.map((i) => [i.term, `${i.why_rising} (${i.evidence_date}) ${srcLinks(i.sources)}`, i.relevance])) : '');
    if (d.type === 'traffic') return `\n## Website traffic rank (Tranco)\n_Lower rank = more traffic. A relative signal, not visitor counts._\n`
      + table(['Domain', 'Rank', 'Change in 30 days'], (d.rows || []).map((x) => [x.domain, x.rank ? `#${num(x.rank)}` : 'not in top 1M', x.change == null ? '' : `${x.change >= 0 ? '+' : ''}${num(x.change)} places`]));
    return '';
  }).join('')],
  ['competitors', 'Competitors', (p, recs) => artBlock(recs, 'competitor_landscape', 'Competitive landscape')
    + recs.filter((r) => r.kind === 'competitor').map((c) => `\n## ${c.key} (${c.data.group})\n\n${shift(c.data.text)}\n`).join('')],
  ['content', 'Content & posts', (p, recs) => {
    const posts = recs.filter((r) => r.kind === 'post');
    const owners = [...new Set(posts.map((x) => x.data.owner))];
    const top = posts.slice().sort((a, b) => (b.data.views || 0) - (a.data.views || 0)).slice(0, 15);
    const label = (x) => cell(x.data.title || x.data.caption || 'post').slice(0, 90);
    return (posts.length
      ? `\n## Posts collected\n` + table(['Account', 'Platforms', 'Posts'], owners.map((o) => [o, [...new Set(posts.filter((x) => x.data.owner === o).map((x) => x.data.platform))].join(', '), posts.filter((x) => x.data.owner === o).length]))
        + `\n### Top posts by views\n` + table(['Date', 'Account', 'Post', 'Views', 'Likes', 'Comments'], top.map((x) => [x.data.date, x.data.owner, x.data.url ? `[${label(x)}](${x.data.url})` : label(x), num(x.data.views), num(x.data.likes), num(x.data.comments)]))
      : '')
      + artBlock(recs, 'community_listening', 'Community listening') + artBlock(recs, 'content_analysis', 'Content analysis');
  }],
  ['creative', 'Creative studio', async (p, recs, pid) => {
    const briefs = recs.filter((r) => r.kind === 'brief');
    if (!briefs.length && !recs.some((r) => r.kind === 'artifact' && r.key === 'cs_avatar')) return '';
    const pack = shift((await creativePack(pid)).replace(/^# .*\n/, ''));
    const others = briefs.filter((b) => b.data.status !== 'approved');
    return pack + (others.length ? `\n## Other concepts (not approved)\n` + table(['Status', 'Concept', 'Hook', 'Stage', 'Motivation'], others.map((b) => [b.data.status, b.data.concept, b.data.hook, b.data.awareness_stage, b.data.motivation])) : '');
  }],
  ['strategy', 'Brand & expansion', (p, recs) => artBlock(recs, 'brand_strategy', 'Brand strategy') + artBlock(recs, 'expansion_plan', 'Expansion plan')],
  ['experiments', 'Experiments', (p, recs) => recs.filter((r) => r.kind === 'experiment').map((e) => {
    const d = e.data;
    return `\n## ${d.name} (${d.status})\n- **Hypothesis:** ${d.hypothesis}\n- **Channel / format:** ${d.channel} · ${d.format}\n- **Variants:** ${(d.variants || []).join(' | ')}\n- **Primary metric:** ${d.primary_metric} (success: ${d.success_threshold})\n`
      + table(['Date', 'Variant', 'Posts', 'Reach', 'Interactions', 'Clicks', 'Sign-ups', 'Txns', 'Notes'], (d.iterations || []).map((i) => [i.date, i.variant, i.posts, i.views, i.interactions, i.clicks, i.signups, i.transactions, i.notes]))
      + (d.review ? `\n### Review\n${shift(d.review, 2)}\n` : '');
  }).join('')],
  ['growth', 'Growth OS', (p, recs) => artBlock(recs, 'g_growth_model', 'Growth model & unit economics') + GROWTH_MODULES.map((m) => artBlock(recs, `g_${m.key}`, m.title)).join('')],
  ['skills', 'Skill lab outputs', (p, recs) => recs.filter((r) => r.kind === 'artifact' && r.key.startsWith('skill_')).map((a) => `\n## ${a.key.slice(6)}\n${a.data.brief ? `_Brief: ${a.data.brief}_\n` : ''}\n${shift(a.data.text)}\n`).join('')],
  ['reports', 'Reports', (p, recs) => artBlock(recs, 'insight_doc', 'Insight document') + artBlock(recs, 'solution_doc', 'Solution document') + artBlock(recs, 'growth_playbook', 'Organic growth playbook') + artBlock(recs, 'deck_outline', 'Deck outline')],
  ['ask', 'Ask the copilot', (p, recs) => recs.filter((r) => r.kind === 'chat').map((c) => `\n## Q: ${c.data.question}\n\n${shift(c.data.answer, 2)}\n`).join('')],
];

// Which tabs have something to export (drives the checkboxes).
export async function sectionStatus(pid) {
  const p = await db.getProject(pid);
  const recs = await db.listRecords(pid);
  const out = [];
  // Count visible text only (link URLs don't take up page space), for the rough page estimate.
  for (const [key, title, fn] of SECTIONS) out.push({ key, title, chars: (await fn(p, recs, pid)).replace(/\]\([^)]*\)/g, ']').length });
  return out;
}

// what = "pack" (every tab) | "custom" (tabs=a,b,c) | "creative" | "record-<id>"
export async function buildDoc(pid, what, tabs = '') {
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

  if (what !== 'pack' && what !== 'custom') throw new Error('Unknown document');
  const want = what === 'pack' ? null : new Set(String(tabs || '').split(',').map((t) => t.trim()).filter(Boolean));
  if (want && !want.size) throw new Error('Pick at least one tab to export');
  const recs = await db.listRecords(pid);
  const chapters = [];
  for (const [key, title, fn] of SECTIONS) {
    if (want && !want.has(key)) continue;
    const body = await fn(p, recs, pid);
    if (body.trim()) chapters.push({ title, body });
  }
  if (!chapters.length) throw new Error('Nothing has been generated yet in the tabs you picked');
  const all = what === 'pack' || chapters.length === SECTIONS.filter(([, , fn]) => fn).length;
  const label = all ? 'full report' : chapters.length === 1 ? chapters[0].title : `report (${chapters.map((c) => c.title).join(', ')})`;
  let md = `# ${p.name}: ${all ? 'full report' : chapters.length === 1 ? chapters[0].title : 'report'}\n\n_Exported ${day()} from GTM Copilot. Claims link to their sources; check figures before quoting them._\n\n**Contents**\n\n${chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}\n`;
  chapters.forEach((c, i) => { md += `\n\n# ${i + 1}. ${c.title}\n${c.body}\n`; });
  return { title: `${p.name} ${all ? 'full report' : chapters.length === 1 ? chapters[0].title : 'report'}`, md, label };
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
