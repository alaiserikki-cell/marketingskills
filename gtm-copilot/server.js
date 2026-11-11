import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
import * as db from './lib/db.js';
import * as M from './lib/modules.js';
import { redditSearch, youtubeChannel, youtubeSearch } from './lib/sources.js';
import { hasGemini, getModel } from './lib/gemini.js';
import { listSkills } from './lib/skills.js';
import { seedCircle } from './lib/seed.js';
import * as G from './lib/growth.js';
import * as K from './lib/knowledge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Password-protect the API when APP_PASSWORD is set (required for public deployments,
// otherwise anyone with the URL could spend your Gemini quota and edit your data).
app.use('/api', (req, res, next) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return next();
  const [, b64 = ''] = (req.headers.authorization || '').split(' ');
  const [user, ...rest] = Buffer.from(b64, 'base64').toString().split(':');
  const userOk = !process.env.APP_USER || user === process.env.APP_USER;
  if (userOk && rest.join(':') === pw) return next();
  res.set('WWW-Authenticate', 'Basic realm="GTM Copilot"').status(401).json({ error: 'Password required' });
});

// Make sure tables exist before the first query (works for both a long-running server and serverless).
let dbReady = null;
app.use('/api', async (req, res, next) => {
  try {
    await (dbReady ||= db.initDb());
    next();
  } catch (e) {
    dbReady = null;
    res.status(500).json({ error: `Database: ${e.message}` });
  }
});

// Wrap async handlers so errors become JSON { error }.
const h = (fn) => async (req, res) => {
  try {
    res.json((await fn(req, res)) ?? { ok: true });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};
const pid = (req) => Number(req.params.id);

// ---------- status ----------
app.get('/api/status', h(async () => ({
  gemini: hasGemini(),
  model: hasGemini() ? await getModel() : null,
  youtube: Boolean(process.env.YOUTUBE_API_KEY),
  storage: db.storageMode(),
  skills: listSkills().length,
})));

// ---------- projects ----------
app.get('/api/projects', h(() => db.listProjects()));
app.post('/api/projects', h((req) => db.createProject(req.body)));
app.post('/api/seed/circle', h(() => seedCircle()));
app.get('/api/projects/:id', h(async (req) => ({ project: await db.getProject(pid(req)), records: await db.listRecords(pid(req)) })));
app.put('/api/projects/:id', h((req) => db.updateProject(pid(req), req.body)));
app.delete('/api/projects/:id', h((req) => db.deleteProject(pid(req))));

// ---------- records (facts, questions, posts, experiments) ----------
app.post('/api/projects/:id/records', h((req) => db.addRecord(pid(req), req.body.kind, req.body.key, req.body.data || {})));
app.put('/api/records/:rid', h((req) => db.updateRecord(req.params.rid, req.body)));
app.delete('/api/records/:rid', h((req) => db.deleteRecord(req.params.rid)));
app.delete('/api/projects/:id/records/:kind', h((req) => db.deleteRecordsByKind(pid(req), req.params.kind, req.query.key)));

// ---------- research modules ----------
app.post('/api/projects/:id/run/profile', h((req) => M.runProfile(pid(req))));
app.post('/api/projects/:id/run/market', h((req) => M.runMarket(pid(req))));
app.post('/api/projects/:id/run/discover-competitors', h((req) => M.discoverCompetitors(pid(req))));
// ---------- knowledge hub ----------
app.post('/api/projects/:id/kb/insights', h((req) => K.runInsights(pid(req), req.body.topic)));
app.post('/api/projects/:id/kb/library', h((req) => K.runLibrary(pid(req), req.body.topic)));
app.post('/api/projects/:id/kb/trends', h((req) => K.runTrends(pid(req), { topic: req.body.topic, terms: req.body.terms })));
app.post('/api/projects/:id/kb/traffic', h((req) => K.runTraffic(pid(req), req.body.domains)));

app.post('/api/projects/:id/run/competitor',h((req) => M.runCompetitor(pid(req), req.body.name, req.body.group)));
app.post('/api/projects/:id/run/competitor-matrix', h((req) => M.runCompetitorMatrix(pid(req))));
app.post('/api/projects/:id/run/questions', h((req) => M.runQuestions(pid(req))));
app.post('/api/projects/:id/run/answers', h((req) => M.runAnswerSynthesis(pid(req))));
app.post('/api/projects/:id/run/content', h((req) => M.runContentAnalysis(pid(req))));
app.post('/api/projects/:id/run/brand', h((req) => M.runBrandStrategy(pid(req))));
app.post('/api/projects/:id/run/expansion', h((req) => M.runExpansion(pid(req))));
app.post('/api/projects/:id/run/experiments', h((req) => M.runExperimentDesign(pid(req))));
app.post('/api/projects/:id/run/experiment-review/:rid', h((req) => M.reviewExperiment(pid(req), req.params.rid)));
app.post('/api/projects/:id/run/report/:type', h((req) => M.runReport(pid(req), req.params.type)));
app.post('/api/projects/:id/ask', h((req) => M.ask(pid(req), req.body.question, req.body.grounded !== false)));

// ---------- Growth OS ----------
app.get('/api/growth/catalog', h(() => ({ modules: G.growthCatalog(), modelInputs: G.MODEL_INPUTS, skills: G.skillCatalog() })));
app.post('/api/projects/:id/growth/:key', h((req) => G.runGrowthModule(pid(req), req.params.key, req.body.input, req.body.artifactKey)));
app.post('/api/projects/:id/growth-model', h((req) => G.runGrowthModel(pid(req), req.body.inputs || {}, req.body.sources || {})));
app.post('/api/growth-model/compute', h((req) => G.computeGrowthModel(req.body.inputs || {})));
app.post('/api/projects/:id/skill/:skill', h((req) => G.runSkill(pid(req), req.params.skill, req.body.brief, !!req.body.grounded)));

// ---------- data collection ----------
async function savePosts(id, owner, posts) {
  for (const p of posts) await db.addRecord(id, 'post', p.url || '', { ...p, owner });
  return { imported: posts.length };
}

app.post('/api/projects/:id/posts/youtube-channel', h(async (req) => {
  const { channel, posts } = await youtubeChannel(req.body.channel, Number(req.body.max) || 50);
  const owner = req.body.owner || channel.title;
  await db.deleteRecordsByKind(pid(req), 'channel', owner);
  await db.addRecord(pid(req), 'channel', owner, { platform: 'youtube', ...channel });
  return { channel, ...(await savePosts(pid(req), owner, posts)) };
}));

app.post('/api/projects/:id/posts/youtube-search', h(async (req) => {
  const posts = await youtubeSearch(req.body.query, Number(req.body.max) || 25);
  return savePosts(pid(req), `category: ${req.body.query}`, posts);
}));

// Reddit's anonymous API often returns 403; fall back to search-grounded community listening.
app.post('/api/projects/:id/posts/reddit', h(async (req) => {
  try {
    const posts = await redditSearch(req.body.query, Number(req.body.max) || 25);
    return savePosts(pid(req), `reddit: ${req.body.query}`, posts);
  } catch {
    await M.runListening(pid(req), req.body.query);
    return { imported: 0, listening: true };
  }
}));
app.post('/api/projects/:id/run/listening', h((req) => M.runListening(pid(req), req.body?.topic)));

// CSV columns: date,platform,format,caption,views,likes,comments,shares,saves,url  (header row required; any order)
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

app.post('/api/projects/:id/posts/csv', h(async (req) => {
  const rows = parseCSV(req.body.csv || '');
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
  const head = rows[0].map((x) => x.trim().toLowerCase());
  // Accepts 1,200 / 2.5k / 1.2M / 3L (lakh)
  const num = (v) => {
    const s = String(v || '').replace(/[,\s]/g, '').toLowerCase();
    const mult = { k: 1e3, m: 1e6, l: 1e5 }[s.slice(-1)] || 1;
    return Math.round((parseFloat(s) || 0) * mult);
  };
  const posts = rows.slice(1).map((r) => {
    const o = Object.fromEntries(head.map((k, i) => [k, (r[i] || '').trim()]));
    return {
      platform: (o.platform || req.body.platform || 'instagram').toLowerCase(),
      format: o.format || o.type || '',
      date: o.date || '',
      title: o.title || '',
      caption: o.caption || o.text || '',
      views: num(o.views || o.reach || o.impressions),
      likes: num(o.likes),
      comments: num(o.comments),
      shares: num(o.shares),
      saves: num(o.saves),
      clicks: num(o.clicks),
      url: o.url || o.link || '',
    };
  });
  return savePosts(pid(req), req.body.owner || 'self', posts);
}));

// ---------- export ----------
app.get('/api/projects/:id/export.md', async (req, res) => {
  const p = await db.getProject(pid(req));
  const recs = await db.listRecords(pid(req));
  const order = ['problem_statement', 'company_profile', 'market_research', 'competitor_landscape', 'ceo_answers_synthesis', 'community_listening', 'content_analysis', 'brand_strategy', 'expansion_plan', 'insight_doc', 'solution_doc', 'growth_playbook', 'deck_outline'];
  let md = `# ${p.name} — GTM research pack\n_Exported ${new Date().toISOString().slice(0, 10)}_\n`;
  const facts = recs.filter((r) => r.kind === 'fact');
  if (facts.length) md += `\n## Verified facts\n${facts.map((f) => `- ${f.data.text} _(source: ${f.data.source})_`).join('\n')}\n`;
  const arts = recs.filter((r) => r.kind === 'artifact');
  const keys = [...order, ...arts.map((a) => a.key).filter((k) => !order.includes(k))];
  for (const key of keys) {
    const a = arts.find((r) => r.key === key);
    if (!a) continue;
    md += `\n\n# ${key.replace(/_/g, ' ')}\n\n${a.data.text}\n`;
    if (a.data.sources?.length) md += `\n**Sources:**\n${a.data.sources.map((s) => `- [${s.title}](${s.uri})`).join('\n')}\n`;
  }
  for (const c of recs.filter((r) => r.kind === 'competitor')) {
    md += `\n\n# Competitor: ${c.key} (${c.data.group})\n\n${c.data.text}\n${(c.data.sources || []).map((s) => `- [${s.title}](${s.uri})`).join('\n')}\n`;
  }
  const qs = recs.filter((r) => r.kind === 'question');
  if (qs.length) md += `\n\n# Questions for the founders\n${qs.map((q) => `- **[${q.data.priority}] ${q.data.question}**\n  - Why: ${q.data.why}\n  - Answer: ${q.data.answer || '_(pending)_'}`).join('\n')}\n`;
  const ex = recs.filter((r) => r.kind === 'experiment');
  if (ex.length) md += `\n\n# Experiments\n${ex.map((e) => `## ${e.data.name} (${e.data.status})\n- Hypothesis: ${e.data.hypothesis}\n- Primary metric: ${e.data.primary_metric}\n- Iterations: ${(e.data.iterations || []).length}\n${e.data.review ? `\n${e.data.review}\n` : ''}`).join('\n')}\n`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/\W+/g, '_')}_gtm_pack.md"`);
  res.send(md);
});

export default app;

// Local server. On Vercel the app is exported and run as a serverless function instead (see api/index.js).
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 3300;
  await (dbReady ||= db.initDb());
  const server = app.listen(PORT, () => {
    console.log(`GTM Copilot running on http://localhost:${PORT}  (storage: ${db.storageMode()}, gemini: ${hasGemini() ? 'on' : 'MISSING KEY'})`);
  });
  server.requestTimeout = 0; // research calls can take a few minutes
}
