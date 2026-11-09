// The GTM modules. Each one: build shared context -> run Gemini with the right marketingskills -> save to DB.
import { generate, generateJSON } from './gemini.js';
import { systemFor } from './skills.js';
import * as db from './db.js';
import { crawlSite } from './sources.js';

const today = () => new Date().toISOString().slice(0, 10);
const clip = (s = '', n = 5000) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

// ---------------- shared context ----------------
// Everything the project knows so far: basics, verified facts, CEO answers and earlier module outputs.
export async function buildContext(pid, { include = 'all', maxPer = 4500, exclude = null } = {}) {
  const p = await db.getProject(pid);
  if (!p) throw new Error('Project not found');
  const recs = await db.listRecords(pid);
  const facts = recs.filter((r) => r.kind === 'fact');
  const answered = recs.filter((r) => r.kind === 'question' && r.data.answer?.trim());
  const artifacts = recs.filter((r) => r.kind === 'artifact');
  const comps = recs.filter((r) => r.kind === 'competitor');

  let ctx = `# Company: ${p.name}\nWebsite: ${p.website || '(not set)'}\nDescription from user: ${p.description || '(none)'}\nToday: ${today()}\n`;
  if (facts.length) ctx += `\n## Verified facts (with sources)\n${facts.map((f) => `- ${f.data.text} — source: ${f.data.source}`).join('\n')}\n`;
  if (answered.length)
    ctx += `\n## Answers from the founder/CEO (primary research — treat as [Observed: CEO answer])\n${answered
      .map((q) => `- Q: ${q.data.question}\n  A: ${q.data.answer}`)
      .join('\n')}\n`;
  if (include === 'all') {
    // Keep the prompt within free-tier limits as the number of analyses grows.
    const per = Math.max(1200, Math.min(maxPer, Math.floor(80000 / Math.max(1, artifacts.length))));
    for (const a of artifacts) {
      if (a.key === 'ask' || a.key === exclude) continue;
      maxPer = per;
      ctx += `\n## Earlier analysis: ${a.key} (${(a.data.generated_at || '').slice(0, 10)})\n${clip(a.data.text, maxPer)}\n`;
    }
    if (comps.length) ctx += `\n## Competitor teardowns\n${comps.map((c) => `### ${c.key} (${c.data.group})\n${clip(c.data.text, 2200)}`).join('\n')}\n`;
  }
  return { project: p, ctx, recs };
}

export function allSources(recs) {
  const seen = new Set();
  const out = [];
  for (const r of recs) for (const s of r.data?.sources || []) if (!seen.has(s.uri)) { seen.add(s.uri); out.push(s); }
  return out;
}

export const ROLE_ANALYST = 'You are a senior growth & GTM strategist and research analyst for consumer internet companies in India. You are rigorous, specific and evidence-first. You write crisp markdown with tables where they help.';

// ---------------- 1. Company profile ----------------
export async function runProfile(pid) {
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const site = await crawlSite(project.website);
  const siteText = site.pages.map((pg) => `### ${pg.url}\n${pg.text}`).join('\n\n');
  const prompt = `${ctx}

## Text read from the company's own website
${siteText || site.error || '(website not set)'}

TASK: Build a complete company understanding document for "${project.name}" using the context above and Google Search. Sections:
1. **The problem in one sentence** (the company's core growth problem right now)
2. **What they sell & how it works** (buyer flow, seller flow, trust mechanisms, pricing/take-rate if public)
3. **Traction & funding** (dated, sourced)
4. **Customers & segments** — who buys, who sells, by category/city; jobs-to-be-done; the motivations that drive them
5. **Positioning today** — how they describe themselves (quote their own words), category, differentiators, brand voice
6. **Channel footprint** — Instagram, YouTube, LinkedIn, Reddit, X, app stores, press: handles, follower counts and activity if found (dated)
7. **Strengths, weaknesses, risks**
8. **Fact sheet table**: | Fact | Label [Observed]/[Inferred]/[Gap] | Source |
9. **Biggest gaps** the team must close with primary research
Label every claim. Be concrete.`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['product-marketing', 'customer-research']), prompt, grounded: true });
  return db.saveArtifact(pid, 'company_profile', { text: out.text, sources: out.sources, queries: out.queries, site_pages: site.pages.map((x) => x.url), site_error: site.error || null, model: out.model });
}

// ---------------- 2. Market research ----------------
export async function runMarket(pid) {
  const { project, ctx } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Market research for ${project.name}'s market. Use Google Search for current, dated, India-specific sources. Sections:
1. **Market definition** — what market exactly (and adjacent markets)
2. **Market size** — TAM / SAM / SOM with method shown step by step; every input sourced or marked [Gap]; show a range, not false precision
3. **Category breakdown** — which product categories are biggest/fastest-growing and why
4. **Consumer behaviour & trust barriers** — what stops people buying/selling (with survey or report evidence)
5. **Geography** — metro vs Tier-2/3 differences, languages, city-level signals
6. **Trends & tailwinds / headwinds** — (e.g. smartphone replacement cycles, sustainability, UPI, regulation, quick commerce expectations)
7. **Where the money/attention is moving** (next 24 months)
8. **So-what for ${project.name}** — 5 bullet implications, each tied to evidence
Label every claim [Observed]/[Inferred]/[Gap].`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['marketing-plan', 'customer-research']), prompt, grounded: true });
  return db.saveArtifact(pid, 'market_research', { text: out.text, sources: out.sources, queries: out.queries, model: out.model });
}

// ---------------- 3. Competitors ----------------
export async function discoverCompetitors(pid) {
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const prompt = `${ctx}

Using Google Search, list the competitors of ${project.name}. Return ONLY JSON, no prose:
{"competitors":[{"name":"","type":"direct|indirect|brand-analog","why":"one line on why it competes or is a useful analog","website":""}]}
Include 5-8 direct/indirect competitors in the same market and geography (include ones that struggled, pulled back or shut down — they are lessons too), plus 2-4 "brand-analog" companies whose brand-building playbook is worth studying.`;
  const out = await generateJSON({ system: ROLE_ANALYST, prompt, grounded: true });
  return { ...out.data, sources: out.sources };
}

export async function runCompetitor(pid, name, group = 'direct') {
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const analog = group === 'brand-analog';
  const prompt = `${ctx}

TASK: Teardown of **${name}** ${analog ? `as a BRAND-BUILDING ANALOG for ${project.name} (not a direct competitor)` : `as a competitor to ${project.name}`}. Use Google Search; cite dated sources.
Sections:
1. **Snapshot** — what they do, founded, funding/scale (dated), core audience
2. **Positioning & brand** — tagline/claims in their own words, what they stand for; ONE national brand or adapted by city/language? what stays consistent vs changes
3. **How they won their first market and expanded** — timeline of key moves (dated); first city/segment; what unlocked the next markets
4. **Organic growth engine** — content formats, creators/influencers, communities, cultural moments, regional language use, referral loops, PR; examples with links if found
5. **What worked** — table: | Move / bet | When | Evidence it worked (metric, coverage, growth) | Source |
6. **What didn't work** — table: | Move / bet | When | What happened (shut down, pulled back from a city/category, pivoted, backlash, layoffs, stalled growth) | Source |. Only include failures you found evidence for; if none found, say "no public evidence found" rather than inventing.
7. **Where they are weak today** — customer complaints, review themes, trust issues (evidence: reviews, Reddit, news)
8. **Why it worked (or didn't) in this market** — the structural reasons (market timing, unit economics, trust, distribution), labelled [Inferred] where reasoning
9. **Lessons for ${project.name}**: copy / adapt / avoid — one line each
10. **${analog ? `What ${project.name} should borrow (and what it should NOT copy at its stage)` : `Where ${project.name} has an edge vs ${name}, and where ${name} beats ${project.name}`}**
Be specific. Never state motives as fact.`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['competitor-profiling', 'reverse-engineer-marketing']), prompt, grounded: true });
  await db.deleteRecordsByKind(pid, 'competitor', name);
  return db.addRecord(pid, 'competitor', name, { group, text: out.text, sources: out.sources, queries: out.queries, generated_at: new Date().toISOString(), model: out.model });
}

export async function runCompetitorMatrix(pid) {
  const { project, ctx, recs } = await buildContext(pid);
  if (!recs.some((r) => r.kind === 'competitor')) throw new Error('Run at least one competitor teardown first.');
  const prompt = `${ctx}

TASK: Using ONLY the teardowns and analysis above (no new facts), produce a competitive landscape synthesis for ${project.name}:
1. **Comparison matrix** (markdown table): rows = ${project.name} + each competitor; columns = Target segment, Core promise, Trust mechanism, Categories, Geography, Key organic channels, Content style, Notable weakness. Use "?" where unknown.
2. **Positioning map** — pick the 2 axes that matter most in this market, place each company (text table with Low/Med/High)
3. **Patterns across winners** — what the successful ones all did
4. **Whitespace** — positions or audiences nobody owns
5. **${project.name}'s defensible edge** — be honest; mark weak edges as weak
6. **Threats** — who could copy ${project.name} fastest and how
7. **5 moves** to exploit the whitespace, each with the competitor evidence behind it`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['competitors', 'product-marketing']), prompt });
  return db.saveArtifact(pid, 'competitor_landscape', { text: out.text, sources: [], model: out.model });
}

// ---------------- 4. Clarifying questions for the CEO ----------------
export async function runQuestions(pid) {
  const { project, ctx, recs } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Draft clarifying questions to send to ${project.name}'s founders/CEO.
Rules:
- Only ask what CANNOT be answered by a quick web search or by the context above. Check the context first.
- Each question must change a decision (positioning, city choice, channel, experiment design, metrics). Say which.
- Prefer past-tense, specific questions ("In the last 90 days, which category…") over hypotheticals.
- Ask for data the team will need for live experiments (channel access, baseline metrics, approval process, budget, brand guardrails).
Return ONLY JSON:
{"problem_one_liner":"the company's problem in one sentence",
 "questions":[{"category":"Business & metrics|Customers|Brand & positioning|Geography & expansion|Channels & content|Experiments & access|Competition","question":"","why":"why it matters","decision":"what decision the answer changes","priority":"top|high|medium"}]}
Give 20-25 questions; mark exactly 5 as "top" (the sharp ones to send first).`;
  const out = await generateJSON({ system: systemFor(ROLE_ANALYST, ['customer-research', 'product-marketing']), prompt });
  // Keep answered questions; replace unanswered ones.
  for (const r of recs.filter((r) => r.kind === 'question' && !r.data.answer?.trim())) await db.deleteRecord(r.id);
  for (const q of out.data.questions || []) await db.addRecord(pid, 'question', '', { ...q, answer: '', status: 'open' });
  await db.saveArtifact(pid, 'problem_statement', { text: out.data.problem_one_liner || '', sources: [] });
  return out.data;
}

export async function runAnswerSynthesis(pid) {
  const { project, ctx, recs } = await buildContext(pid);
  if (!recs.some((r) => r.kind === 'question' && r.data.answer?.trim())) throw new Error('No answers recorded yet.');
  const prompt = `${ctx}

TASK: The founder/CEO answers above are new primary research. Write "What the CEO's answers change":
1. Key takeaways (each tied to the answer it came from)
2. Which earlier assumptions/analysis are now confirmed, contradicted or still open (cite the section)
3. Updated problem statement in one sentence
4. Follow-up questions (max 5) where answers were vague or raised new questions
5. What to re-run in the tool (company profile, market, competitors, experiments) and why`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['customer-research']), prompt });
  return db.saveArtifact(pid, 'ceo_answers_synthesis', { text: out.text, sources: [] });
}

// ---------------- 5. Content / post analysis ----------------
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const interactions = (p) => (+p.likes || 0) + (+p.comments || 0) + (+p.shares || 0) + (+p.saves || 0);
const engRate = (p) => (+p.views > 0 ? interactions(p) / +p.views : null);

function groupStats(posts, keyFn) {
  const g = {};
  for (const p of posts) {
    const k = keyFn(p) || 'unknown';
    (g[k] ||= []).push(p);
  }
  return Object.entries(g)
    .map(([k, arr]) => {
      const rates = arr.map(engRate).filter((x) => x != null);
      return {
        group: k,
        posts: arr.length,
        median_views: Math.round(median(arr.map((p) => +p.views || 0))),
        median_interactions: Math.round(median(arr.map(interactions))),
        median_engagement_rate_pct: rates.length ? +(median(rates) * 100).toFixed(2) : null,
      };
    })
    .sort((a, b) => b.median_views - a.median_views || b.median_interactions - a.median_interactions);
}

const table = (rows) => {
  if (!rows.length) return '(none)';
  const cols = Object.keys(rows[0]);
  return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${cols.map((c) => r[c] ?? '').join(' | ')} |`).join('\n')}`;
};

export async function tagPosts(pid) {
  const posts = (await db.listRecords(pid, 'post')).filter((r) => !r.data.tags);
  for (let i = 0; i < posts.length; i += 60) {
    const batch = posts.slice(i, i + 60);
    const prompt = `Classify each social post. Return ONLY JSON: {"tags":[{"id":0,"motivation":"value|trust|discovery|convenience|circular|other","content_type":"deal/price reveal|customer story|product comparison|behind-the-scenes/verification|creator-led|educational/how-to|meme/trend|announcement/brand|community/UGC|other","language":"english|hindi|hinglish|kannada|tamil|telugu|marathi|bengali|other","hook":"first-3-seconds/opening hook in <=10 words","city":"city mentioned or empty"}]}
Posts:\n${batch.map((r) => `id=${r.id} | ${r.data.platform} | ${r.data.format || ''} | ${(r.data.title || '').slice(0, 120)} | ${(r.data.caption || '').slice(0, 300).replace(/\n/g, ' ')}`).join('\n')}`;
    const out = await generateJSON({ prompt, temperature: 0.1 });
    for (const t of out.data.tags || []) {
      if (batch.some((b) => b.id === Number(t.id))) await db.updateRecord(t.id, { tags: t });
    }
  }
}

export async function runContentAnalysis(pid) {
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  await tagPosts(pid);
  const posts = (await db.listRecords(pid, 'post')).map((r) => ({ ...r.data, id: r.id }));
  if (!posts.length) throw new Error('No posts yet. Import a CSV, fetch YouTube, or fetch Reddit first.');
  const T = (p) => p.tags || {};
  const sections = {
    'By account (owner)': groupStats(posts, (p) => p.owner),
    'By platform': groupStats(posts, (p) => p.platform),
    'By format': groupStats(posts, (p) => `${p.platform}:${p.format || 'post'}`),
    'By motivation': groupStats(posts, (p) => T(p).motivation),
    'By content type': groupStats(posts, (p) => T(p).content_type),
    'By language': groupStats(posts, (p) => T(p).language),
  };
  const top = [...posts].sort((a, b) => (+b.views || interactions(b)) - (+a.views || interactions(a))).slice(0, 12);
  const bottom = [...posts].filter((p) => p.owner === project.name || p.owner === 'self').sort((a, b) => (+a.views || interactions(a)) - (+b.views || interactions(b))).slice(0, 8);
  const statsMd = Object.entries(sections).map(([k, v]) => `### ${k}\n${table(v)}`).join('\n\n');
  const fmt = (p) => `- [${p.owner}] ${p.platform}/${p.format || ''} ${p.date || ''} views=${p.views || 0} interactions=${interactions(p)} type=${T(p).content_type || '?'} motivation=${T(p).motivation || '?'} lang=${T(p).language || '?'} | ${(p.title || p.caption || '').slice(0, 140)} ${p.url || ''}`;

  const prompt = `${ctx}

## Computed statistics (calculated by the app from ${posts.length} posts — these numbers are exact, do not change them)
${statsMd}

## Top posts
${top.map(fmt).join('\n')}

## ${project.name}'s weakest posts
${bottom.map(fmt).join('\n') || '(none tagged as own)'}

TASK: Write a content performance analysis for ${project.name}:
1. **What's working** — formats, content types, motivations, hooks, languages; cite the numbers above
2. **What isn't** — and the likely reason (label [Inferred])
3. **Competitor/category content lessons** — what others get right that ${project.name} isn't doing
4. **Sample-size caveats** — flag any group with <5 posts as directional only
5. **Content bets** — 6 specific post ideas (hook, format, platform, motivation, language) to test next, each justified by the data
6. **Measurement fixes** — what to track that isn't tracked yet (e.g. link clicks, sign-ups, UTM per post)`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['social', 'video', 'content-strategy']), prompt });
  return db.saveArtifact(pid, 'content_analysis', { text: `## Computed statistics\n\n${statsMd}\n\n---\n\n${out.text}`, sources: [], stats: sections, model: out.model });
}

// Community listening via Google Search grounding (Reddit, Quora, forums, app reviews, X).
export async function runListening(pid, topic) {
  const { project, ctx } = await buildContext(pid, { include: 'basic' });
  const q = topic || `${project.name} and buying/selling pre-owned products online in India`;
  const prompt = `${ctx}

TASK: Community listening on: "${q}". Use Google Search to find real discussions on Reddit (e.g. r/india, r/bangalore, r/IndianGaming, r/IndiaTech), Quora, forums, app-store/Play-store reviews and X. Also look for mentions of ${project.name} and its competitors.
Output:
1. **What people are saying** — themes table: | Theme | Motivation (value/trust/discovery/convenience/circular) | Sentiment | Example (paraphrase, with link) | How common |
2. **Top fears & objections** about buying/selling pre-owned online
3. **What makes people trust a seller/platform** (in their words, paraphrased)
4. **Mentions of ${project.name} and competitors** — what's praised, what's criticised
5. **Language & city signals** — Hinglish/regional terms, city-specific threads
6. **Content & community ideas** — 5 post/thread ideas that answer real questions found
Only describe threads you actually found via search; link them. If little is found, say so.`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['customer-research', 'community-marketing']), prompt, grounded: true });
  return db.saveArtifact(pid, 'community_listening', { text: out.text, sources: out.sources, queries: out.queries, topic: q, model: out.model });
}

// ---------------- 6. Brand strategy & expansion ----------------
export async function runBrandStrategy(pid) {
  const { project, ctx } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Brand strategy recommendation for ${project.name}: "One brand, different Indias?"
1. **Recommended national positioning** — one-line positioning statement, the single idea the brand should own, 3 proof points, brand tone
2. **Message hierarchy** across the motivations (value, trust, discovery, convenience, circular consumption): which leads, which supports, by segment — with evidence
3. **What stays national vs what localises** — table: Element | National (fixed) | Local (flex) | Why
4. **Where localisation creates advantage** — specific cities/languages/categories, with evidence and expected effect
5. **Lessons from brand analogs** (from the teardowns) — what to borrow now vs later
6. **Risks** and how to de-risk with experiments
7. **Evidence table** — | Claim | Label | Source |
Choose ONE recommendation. Don't list options without choosing.`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['product-marketing', 'marketing-psychology', 'copywriting']), prompt, grounded: true });
  return db.saveArtifact(pid, 'brand_strategy', { text: out.text, sources: out.sources, queries: out.queries, model: out.model });
}

export async function runExpansion(pid) {
  const { project, ctx } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Where should ${project.name} expand next? Use Google Search for city/category data.
1. **City prioritisation** — score 8-10 Indian cities on: demand signal for the categories, digital/UPI adoption, pre-owned acceptance, logistics feasibility, language/creator ecosystem, competition intensity. Table with 1-5 scores + total + sources. Recommend the next 2-3 and the sequence.
2. **Category expansion** — which categories to push/add next, with reasons
3. **Segment expansion** — new audiences (students, young professionals, parents, resellers, collectors…) with job-to-be-done
4. **Supply side** — how to get sellers/listings in a new city before demand
5. **Channel expansion** — which organic channels to add/scale, in which order
6. **City-launch playbook** — week-by-week first 8 weeks in a new city (organic-first)
7. **Kill/continue metrics** for a new city
Label every claim.`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['marketing-plan', 'marketing-loops', 'community-marketing', 'launch']), prompt, grounded: true });
  return db.saveArtifact(pid, 'expansion_plan', { text: out.text, sources: out.sources, queries: out.queries, model: out.model });
}

// ---------------- 7. Experiments ----------------
export async function runExperimentDesign(pid) {
  const { project, ctx } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Design live organic growth experiments for ${project.name} (no paid spend). Cover at minimum:
(a) find the strongest brand message (deals/discovery vs trust/safety vs convenience),
(b) national vs local content (city-specific stories, regional language, local creators),
(c) an organic acquisition engine (repeatable formats: deals found, customer stories, comparisons/price discoveries, behind-the-scenes verification, creator-led discovery, community recommendations).
Add 2-3 more based on the evidence. Each must be runnable in 1-2 weeks by 2 students on Instagram/YouTube/Reddit/LinkedIn.
Return ONLY JSON:
{"experiments":[{"name":"","theme":"message|national-vs-local|acquisition-engine|other","hypothesis":"If we…, then…, because…","channel":"","format":"","variants":["A: …","B: …"],"audience":"","primary_metric":"","secondary_metrics":[""],"tracking":"how to measure (UTM, link-in-bio, promo code, form)","duration_days":7,"min_sample":"e.g. 3 posts per variant / 5k reach","success_threshold":"","ice":{"impact":1,"confidence":1,"ease":1},"cost_inr":0,"steps":["…"],"evidence":"which insight/data motivated it"}]}`;
  const out = await generateJSON({ system: systemFor(ROLE_ANALYST, ['ab-testing', 'marketing-ideas', 'marketing-loops', 'social']), prompt });
  const created = [];
  for (const e of out.data.experiments || []) created.push(await db.addRecord(pid, 'experiment', e.name, { ...e, status: 'planned', iterations: [] }));
  return created;
}

export async function reviewExperiment(pid, recordId) {
  const exp = await db.getRecord(recordId);
  if (!exp) throw new Error('Experiment not found');
  const { ctx } = await buildContext(pid, { include: 'basic' });
  const prompt = `${ctx}

## Experiment
${JSON.stringify({ ...exp.data, review: undefined }, null, 2)}

TASK: Review the results logged in "iterations".
1. Result per variant vs the success threshold (compute rates: engagement rate, CTR, sign-up rate where data allows; show the math)
2. Is it statistically meaningful or directional only? (be honest about small samples)
3. Learnings — what this says about the audience
4. Decision: scale / iterate / kill — and why
5. Next iteration design: exact change, hypothesis, what to measure`;
  const out = await generate({ system: systemFor(ROLE_ANALYST, ['ab-testing']), prompt });
  return db.updateRecord(recordId, { review: out.text, reviewed_at: new Date().toISOString() });
}

// ---------------- 8. Reports ----------------
const REPORTS = {
  insight_doc: {
    skills: ['customer-research', 'product-marketing'],
    task: (n) => `Write the INSIGHT DOCUMENT for ${n}: company research summary, competitor analysis summary, target personas (2-3, evidenced), then 3-5 INSIGHTS. Each insight: headline (non-obvious), evidence (primary + secondary, sources named), "so what" for ${n}. End with an evidence gaps list. No new facts beyond the context.`,
  },
  solution_doc: {
    skills: ['marketing-plan', 'ab-testing'],
    task: (n) => `Write the SOLUTION DOCUMENT for ${n}: problem in one sentence; data gathered (summary); frameworks used; ONE recommendation (not options) with cost (₹, time, people) and expected impact (with assumptions shown); the tools/build; the experiment plan; risks. Numbers must come from the context or be clearly labelled assumptions.`,
  },
  growth_playbook: {
    skills: ['content-strategy', 'social', 'marketing-loops', 'community-marketing'],
    task: (n) => `Write the ORGANIC GROWTH PLAYBOOK ${n} can keep running: winning channels, content formats (with templates/hooks), messaging by motivation and city, posting cadence, creator & community programme, localisation rules, weekly operating rhythm, metrics dashboard, and what to stop doing. Ground every rule in experiment/content data where available; label untested rules as hypotheses.`,
  },
  deck_outline: {
    skills: ['product-marketing'],
    task: (n) => `Write a 10-12 slide recommendation deck outline for ${n}'s founders. For each slide: message title (a full-sentence takeaway), 3-4 bullets of content, the chart/visual to show (with the exact data series from the context), and speaker notes. Story: problem → insight → recommendation → evidence from experiments → playbook → ask. Must fit a 10-minute talk.`,
  },
};

export async function runReport(pid, type) {
  const spec = REPORTS[type];
  if (!spec) throw new Error(`Unknown report ${type}`);
  const { project, ctx, recs } = await buildContext(pid, { maxPer: 7000 });
  const exps = recs.filter((r) => r.kind === 'experiment');
  const expMd = exps.length ? `\n## Experiments\n${exps.map((e) => `- ${e.data.name} [${e.data.status}] iterations=${JSON.stringify(e.data.iterations || [])}${e.data.review ? `\n  Review: ${clip(e.data.review, 1200)}` : ''}`).join('\n')}` : '';
  const out = await generate({ system: systemFor(ROLE_ANALYST, spec.skills), prompt: `${ctx}${expMd}\n\nTASK: ${spec.task(project.name)}\nKeep [Observed]/[Inferred]/[Gap] labels on material claims.` });
  const sources = allSources(recs);
  return db.saveArtifact(pid, type, { text: out.text + (sources.length ? `\n\n---\n### Sources consulted\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.uri})`).join('\n')}` : ''), sources: [], model: out.model });
}

// ---------------- 9. Ask the copilot ----------------
export async function ask(pid, question, grounded = true) {
  const { ctx } = await buildContext(pid);
  const out = await generate({
    system: systemFor(ROLE_ANALYST, ['product-marketing']),
    prompt: `${ctx}\n\nQUESTION FROM THE TEAM: ${question}\n\nAnswer directly and specifically. Use the context first; use search for anything new and cite it. Label claims.`,
    grounded,
  });
  await db.addRecord(pid, 'chat', '', { question, answer: out.text, sources: out.sources, at: new Date().toISOString() });
  return out;
}
