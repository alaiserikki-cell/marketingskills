// GTM Copilot front end — plain JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Links open in a new tab; a link whose text is a bare domain (an inline citation) renders as a small source tag.
const md = (t = '') => DOMPurify.sanitize(marked.parse(t))
  .replace(/<a href="([^"]+)">([a-z0-9-]+(?:\.[a-z0-9-]+)+)<\/a>/g, '<a class="cite" title="Open source" href="$1">$2</a>')
  .replace(/<a /g, '<a target="_blank" rel="noopener" ');
const citeLinks = (srcs = []) => srcs.map((s) => `<a class="cite" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open source">${esc(s.site)}</a>`).join(' ');

const state = { projectId: null, project: null, records: [], tab: 'setup', status: {}, catalog: { modules: [], modelInputs: [], skills: [] }, modelPreview: null };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), err ? 9000 : 3500);
}

// Run a long task with a button spinner; refresh after.
async function run(btn, fn, okMsg) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.classList.add('spin');
  try {
    const out = await fn();
    if (okMsg) toast(okMsg);
    await loadProject();
    return out;
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('spin');
    btn.textContent = label;
  }
}

const recs = (kind) => state.records.filter((r) => r.kind === kind);
const artifact = (key) => state.records.find((r) => r.kind === 'artifact' && r.key === key);
const P = (path) => `/api/projects/${state.projectId}${path}`;

function sourcesHtml(sources = []) {
  if (!sources.length) return '';
  return `<details class="sources"><summary>All ${sources.length} sources searched</summary><ol>${sources.map((s) => `<li><a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ol></details>`;
}

// ---------------- downloads: PDF / Word / Markdown ----------------
const dlButtons = (what, label = '') => `<span class="dl">${label ? `<span class="meta">${label}</span>` : ''}<button class="small ghost" data-dl="${what}" data-fmt="pdf">PDF</button><button class="small ghost" data-dl="${what}" data-fmt="docx">Word</button><button class="small ghost" data-dl="${what}" data-fmt="md">.md</button></span>`;

function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`Could not load ${src}`)); document.head.appendChild(s); });
}
let pdfLibs = null;
const ensurePdf = () => (pdfLibs ||= (async () => {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.5.30/browser.js');
})().catch((e) => { pdfLibs = null; throw e; }));

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function downloadDoc(what, fmt) {
  const url = P(`/doc/${what}.${fmt === 'docx' ? 'docx' : 'md'}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `document.${fmt}`;
  if (fmt !== 'pdf') return saveBlob(await res.blob(), name);
  // The PDF font (Roboto) has ₹ but no arrows, ticks or emoji: swap them for text so nothing prints as a box.
  const md = (await res.text())
    .replace(/\$\\rightarrow\$|[→⟶➔➜]/g, '->').replace(/[←]/g, '<-').replace(/[↑▲]/g, '+').replace(/[↓▼]/g, '-')
    .replace(/[✓✔✅]/g, 'Yes').replace(/[✗✘❌]/g, 'No').replace(/[★⭐]/g, '*').replace(/[⚠]/g, '!')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
  const title = decodeURIComponent(res.headers.get('X-Doc-Title') || 'Document');
  await ensurePdf();
  const html = DOMPurify.sanitize(marked.parse(md));
  const content = htmlToPdfmake(html, { tableAutoSize: true, defaultStyles: {
    h1: { fontSize: 17, bold: true, marginBottom: 6, color: '#17211d' }, h2: { fontSize: 13.5, bold: true, marginTop: 10, marginBottom: 4, color: '#235e52' },
    h3: { fontSize: 11.5, bold: true, marginTop: 6, marginBottom: 3 }, a: { color: '#1a6b5a', decoration: 'underline' },
    th: { bold: true, fillColor: '#235e52', color: '#ffffff' }, td: { fontSize: 8.5 }, p: { marginBottom: 4 }, li: { marginBottom: 2 },
  } });
  pdfMake.createPdf({
    info: { title, creator: 'GTM Copilot' }, pageSize: 'A4', pageMargins: [36, 40, 36, 44],
    defaultStyle: { fontSize: 9.5, lineHeight: 1.2 }, content,
    footer: (cur, total) => ({ text: `${title} · ${cur} / ${total}`, alignment: 'center', fontSize: 7.5, color: '#888', margin: [0, 14, 0, 0] }),
  }).download(name.replace(/\.md$/, '.pdf'));
}

function artifactCard(key, title, hint, runPath, extraBtns = '') {
  const a = artifact(key);
  return `<div class="card">
    <h2>${title}</h2><p class="hint">${hint}</p>
    <div class="row"><button data-run="${runPath}" data-msg="${esc(title)} ready">${a ? 'Re-run' : 'Run'} ${title.toLowerCase()}</button>${extraBtns}
    ${a ? `<span class="meta">Generated ${new Date(a.data.generated_at).toLocaleString()} ${a.data.model ? `· ${esc(a.data.model)}` : ''}</span>${dlButtons(`record-${a.id}`)}` : ''}</div>
    ${a?.data.site_error ? `<p class="hint">⚠ ${esc(a.data.site_error)}</p>` : ''}
    ${a ? `<div class="md">${md(a.data.text)}</div>${sourcesHtml(a.data.sources)}` : '<p class="meta">Not run yet.</p>'}
  </div>`;
}

// ---------------- tabs ----------------
const TABS = {
  setup() {
    const p = state.project;
    const facts = recs('fact');
    const s = state.status;
    return `
    <div class="card">
      <h2>Company</h2>
      <p class="hint">Every module reads this, plus verified facts and the CEO's answers. Add the website so the tool can read it.</p>
      <div class="row"><input id="pName" class="grow" placeholder="Company name" value="${esc(p.name)}"><input id="pWeb" class="grow" placeholder="Website, e.g. example.com" value="${esc(p.website)}"></div>
      <textarea id="pDesc" placeholder="What the company does and the problem you're solving">${esc(p.description)}</textarea>
      <div class="row"><button id="saveProject">Save</button><button class="danger" id="delProject">Delete project</button></div>
    </div>
    <div class="card">
      <h2>Verified facts</h2>
      <p class="hint">Facts you have a source for (case PDF, founder call, a report). They're treated as ground truth in every prompt.</p>
      ${facts.map((f) => `<div class="row"><span style="flex:1">${esc(f.data.text)} <span class="meta">— ${esc(f.data.source)}</span></span><button class="small danger" data-del="${f.id}">✕</button></div>`).join('')}
      <div class="row"><input id="factText" class="grow" placeholder="Fact"><input id="factSrc" placeholder="Source"><button id="addFact">Add fact</button></div>
    </div>
    <div class="card">
      <h2>Connections</h2>
      <div class="kv"><b>Gemini</b>${s.gemini ? `✅ ${esc(s.model)}` : '❌ add GEMINI_API_KEY to .env'}</div>
      <div class="kv"><b>YouTube API</b>${s.youtube ? '✅' : '❌ add YOUTUBE_API_KEY to .env (optional)'}</div>
      <div class="kv"><b>Storage</b>${s.storage === 'neon' ? '✅ Neon Postgres' : '⚠ local JSON file (add DATABASE_URL for Neon)'}</div>
      <div class="kv"><b>Skills loaded</b>${s.skills} from the marketingskills library</div>
      <p class="hint" style="margin-top:10px">Suggested order: CEO questions → Company → Market → Competitors → Content → Brand &amp; expansion → Experiments → Reports. Re-run modules after you record CEO answers.</p>
    </div>`;
  },

  company: () => artifactCard('company_profile', 'Company profile', 'Reads the website + searches the web: what they sell, traction, segments, positioning, channels, a sourced fact sheet and the gaps to close.', '/run/profile'),
  market: () => artifactCard('market_research', 'Market research', 'Market definition, TAM/SAM/SOM with method, categories, trust barriers, geography, trends and so-whats — all sourced.', '/run/market'),

  competitors() {
    const comps = recs('competitor');
    const disc = state.discovered || [];
    return `
    <div class="card">
      <h2>Competitors &amp; brand analogs</h2>
      <p class="hint">Teardown = positioning, how they won their first market and expanded, organic engine, strengths, weaknesses, why it worked, and your edge. Use <b>brand-analog</b> for companies like Meesho/Blinkit/Zepto/Flipkart whose brand playbook you're studying.</p>
      <div class="row"><button id="discover" class="ghost">Suggest competitors with search</button></div>
      ${disc.length ? `<table class="simple"><tr><th></th><th>Name</th><th>Type</th><th>Why</th></tr>${disc.map((c, i) => `<tr><td><input type="checkbox" data-disc="${i}" checked></td><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${esc(c.why)}</td></tr>`).join('')}</table><div class="row"><button id="runDisc">Tear down selected</button></div>` : ''}
      <div class="row"><input id="compNames" class="grow" placeholder="Names, comma separated (e.g. OLX, Cashify)"><select id="compGroup"><option value="direct">direct</option><option value="indirect">indirect</option><option value="brand-analog">brand-analog</option></select><button id="runComps">Tear down</button></div>
      <div class="row"><button class="ghost small" id="analogs">Use case analogs: Meesho, Blinkit, Zepto, Flipkart</button></div>
      <p class="meta" id="compProgress"></p>
    </div>
    ${artifactCard('competitor_landscape', 'Competitive landscape', 'Matrix, positioning map, patterns across winners, whitespace, your defensible edge and threats — synthesised from the teardowns.', '/run/competitor-matrix')}
    <div class="card"><h2>Teardowns (${comps.length})</h2>
      ${comps.map((c) => `<details><summary>${esc(c.key)} <span class="tag">${esc(c.data.group)}</span><span class="meta">${new Date(c.data.generated_at).toLocaleDateString()}</span></summary>
        <div class="row"><button class="small ghost" data-recomp="${esc(c.key)}" data-group="${esc(c.data.group)}">Re-run</button><button class="small danger" data-del="${c.id}">Delete</button>${dlButtons(`record-${c.id}`)}</div>
        <div class="md">${md(c.data.text)}</div>${sourcesHtml(c.data.sources)}</details>`).join('') || '<p class="meta">None yet.</p>'}
    </div>`;
  },

  questions() {
    const qs = recs('question');
    const ps = artifact('problem_statement');
    const answered = qs.filter((q) => q.data.answer?.trim()).length;
    const cats = [...new Set(qs.map((q) => q.data.category))];
    const rank = { top: 0, high: 1, medium: 2 };
    return `
    <div class="card">
      <h2>Clarifying questions for the founders</h2>
      <p class="hint">Generates questions that can't be answered by a quick search and that each change a decision. The 5 highlighted are the sharp ones to send first (Week 1). Paste the CEO's answers back in; every module then treats them as primary research.</p>
      <div class="row"><button data-run="/run/questions" data-msg="Questions ready">${qs.length ? 'Regenerate unanswered' : 'Generate questions'}</button>
        <button class="ghost" id="copyTop" ${qs.length ? '' : 'disabled'}>Copy top 5 as message</button>
        <button class="ghost" id="copyAll" ${qs.length ? '' : 'disabled'}>Copy all</button>
        <span class="meta">${answered}/${qs.length} answered</span></div>
      ${ps ? `<p><b>Problem in one sentence:</b> ${esc(ps.data.text)}</p>` : ''}
      <div class="row"><input id="newQ" class="grow" placeholder="Add your own question"><button class="ghost" id="addQ">Add</button></div>
    </div>
    ${cats.map((cat) => `<div class="card"><h3>${esc(cat)}</h3>${qs.filter((q) => q.data.category === cat).sort((a, b) => rank[a.data.priority] - rank[b.data.priority]).map((q) => `
      <div class="q ${q.data.priority === 'top' ? 'top' : ''}">
        <div class="qtext">${q.data.priority === 'top' ? '★ ' : ''}${esc(q.data.question)}</div>
        <div class="meta">${q.data.why ? `Why: ${esc(q.data.why)} · ` : ''}${q.data.decision ? `Changes: ${esc(q.data.decision)}` : ''}</div>
        <textarea data-answer="${q.id}" placeholder="CEO's answer…">${esc(q.data.answer || '')}</textarea>
        <div class="row"><select data-prio="${q.id}">${['top', 'high', 'medium'].map((p) => `<option ${p === q.data.priority ? 'selected' : ''}>${p}</option>`).join('')}</select><button class="small danger" data-del="${q.id}">Delete</button></div>
      </div>`).join('')}</div>`).join('')}
    ${artifactCard('ceo_answers_synthesis', 'What the answers change', 'After answers come in: takeaways, confirmed vs contradicted assumptions, follow-ups, and which modules to re-run.', '/run/answers')}`;
  },

  content() {
    const posts = recs('post');
    const owners = {};
    posts.forEach((p) => { (owners[p.data.owner] ||= { n: 0, platforms: new Set() }).n++; owners[p.data.owner].platforms.add(p.data.platform); });
    return `
    <div class="card">
      <h2>Collect posts</h2>
      <p class="hint">Bring in your own and competitors' posts. Instagram/LinkedIn have no free API: export insights (Meta Business Suite → Insights → Content → Export, LinkedIn page analytics) or copy numbers into a sheet and paste the CSV.</p>
      <div class="grid2">
        <div><h3>Paste CSV (Instagram / LinkedIn / any)</h3>
          <p class="meta">Header row, any order: date,platform,format,caption,views,likes,comments,shares,saves,clicks,url</p>
          <textarea id="csv" placeholder="date,platform,format,caption,views,likes,comments,shares,saves,url"></textarea>
          <div class="row"><input id="csvOwner" placeholder="Account owner (e.g. Circle, OLX)" value="${esc(state.project.name)}"><button id="importCsv">Import</button></div></div>
        <div><h3>YouTube channel</h3>
          <div class="row"><input id="ytChannel" class="grow" placeholder="@handle or channel URL"><input id="ytOwner" placeholder="Owner label"><button id="ytFetch">Fetch latest 50</button></div>
          <h3>YouTube category scan</h3>
          <div class="row"><input id="ytQuery" class="grow" placeholder="e.g. second hand iphone bangalore"><button id="ytSearch">Top videos</button></div>
          <h3>Reddit &amp; community listening</h3>
          <p class="meta">Tries Reddit's public search; if Reddit blocks it, finds Reddit/Quora/forum/review discussions through Google Search instead.</p>
          <div class="row"><input id="rdQuery" class="grow" placeholder="e.g. buying used phone online india"><button id="rdFetch">Listen</button></div></div>
      </div>
    </div>
    <div class="card"><h2>Posts collected (${posts.length})</h2>
      <table class="simple"><tr><th>Owner</th><th>Platforms</th><th>Posts</th><th></th></tr>
      ${Object.entries(owners).map(([o, v]) => `<tr><td>${esc(o)}</td><td>${[...v.platforms].join(', ')}</td><td>${v.n}</td><td><button class="small danger" data-delowner="${esc(o)}">Remove</button></td></tr>`).join('') || '<tr><td colspan=4 class="meta">No posts yet.</td></tr>'}</table>
    </div>
    ${artifactCard('community_listening', 'Community listening', 'Themes, fears, trust drivers, competitor mentions and language/city signals from real online discussions, with links.', '/run/listening')}
    ${artifactCard('content_analysis', 'Content analysis', 'The app computes exact medians (views, interactions, engagement rate) by account, format, motivation, content type and language; Gemini tags each post and explains what is working and what isn’t.', '/run/content')}`;
  },

  strategy: () =>
    artifactCard('brand_strategy', 'Brand strategy', 'One brand, different Indias? National positioning, message hierarchy across the five motivations, what stays national vs local, and where localisation wins.', '/run/brand') +
    artifactCard('expansion_plan', 'Expansion plan', 'City scoring and sequence, categories, segments, supply-side, channels, and an 8-week organic city-launch playbook.', '/run/expansion'),

  experiments() {
    const ex = recs('experiment');
    return `
    <div class="card"><h2>Live growth experiments</h2>
      <p class="hint">Designs the three required experiments (brand message, national vs local, acquisition engine) plus extras, from everything the tool knows. Log each iteration's numbers, then get a review: scale / iterate / kill.</p>
      <div class="row"><button data-run="/run/experiments" data-msg="Experiments designed">${ex.length ? 'Design more' : 'Design experiments'}</button></div>
    </div>
    ${ex.map((e) => {
      const d = e.data;
      const ice = d.ice ? (d.ice.impact * d.ice.confidence * d.ice.ease) : '';
      return `<div class="card">
        <div class="row"><h2 style="flex:1">${esc(d.name)}</h2><span class="tag">${esc(d.theme || '')}</span><span class="tag">ICE ${ice}</span>
          <select data-status="${e.id}">${['planned', 'running', 'done', 'killed'].map((s) => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <button class="small danger" data-del="${e.id}">✕</button></div>
        <div class="kv"><b>Hypothesis</b>${esc(d.hypothesis)}</div>
        <div class="kv"><b>Channel / format</b>${esc(d.channel)} · ${esc(d.format)}</div>
        <div class="kv"><b>Variants</b>${(d.variants || []).map(esc).join(' | ')}</div>
        <div class="kv"><b>Primary metric</b>${esc(d.primary_metric)} · success: ${esc(d.success_threshold)}</div>
        <div class="kv"><b>Tracking</b>${esc(d.tracking || '')}</div>
        <div class="kv"><b>Duration / sample</b>${esc(d.duration_days)} days · ${esc(d.min_sample || '')} · cost ₹${esc(d.cost_inr ?? 0)}</div>
        <div class="kv"><b>Evidence</b>${esc(d.evidence || '')}</div>
        ${d.steps?.length ? `<details><summary>Steps</summary><ol>${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
        <h3>Iterations (${(d.iterations || []).length})</h3>
        <table class="simple"><tr><th>Date</th><th>Variant</th><th>Posts</th><th>Reach/views</th><th>Interactions</th><th>Clicks</th><th>Sign-ups</th><th>Transactions</th><th>Notes</th></tr>
        ${(d.iterations || []).map((it) => `<tr><td>${esc(it.date)}</td><td>${esc(it.variant)}</td><td>${esc(it.posts)}</td><td>${esc(it.views)}</td><td>${esc(it.interactions)}</td><td>${esc(it.clicks)}</td><td>${esc(it.signups)}</td><td>${esc(it.transactions)}</td><td>${esc(it.notes)}</td></tr>`).join('')}</table>
        <div class="row" data-iter="${e.id}">
          <input name="variant" placeholder="Variant" size="8"><input name="posts" placeholder="Posts" size="4"><input name="views" placeholder="Reach/views" size="8"><input name="interactions" placeholder="Interactions" size="8"><input name="clicks" placeholder="Clicks" size="5"><input name="signups" placeholder="Sign-ups" size="6"><input name="transactions" placeholder="Txns" size="5"><input name="notes" placeholder="Notes" class="grow">
          <button class="small" data-additer="${e.id}">Log</button></div>
        <div class="row"><button class="ghost" data-review="${e.id}">${d.review ? 'Re-review' : 'Review results'}</button></div>
        ${d.review ? `<div class="md">${md(d.review)}</div>` : ''}
      </div>`;
    }).join('')}`;
  },

  reports: () => `
    <div class="card"><h2>Deliverables</h2>
      <p class="hint">Built only from what's in the tool (facts, CEO answers, research, teardowns, content data, experiments). Run the research modules first. Download everything as one document (PDF, Word or Markdown), or any single report from its own card.</p>
      <div class="row">${dlButtons('pack', 'Full research pack:')}</div>
    </div>
    ${artifactCard('insight_doc', 'Insight document', 'Company + competitor research, personas, and 3–5 insights each with evidence and a "so what" (Week 2).', '/run/report/insight_doc')}
    ${artifactCard('solution_doc', 'Solution document', 'One recommendation with cost and impact, frameworks, tools and approach (Checkpoint 1).', '/run/report/solution_doc')}
    ${artifactCard('growth_playbook', 'Organic growth playbook', 'Channels, formats, messaging, localisation rules, cadence and metrics Circle can keep running.', '/run/report/growth_playbook')}
    ${artifactCard('deck_outline', 'Deck outline', '10–12 slides with message titles, chart specs and speaker notes for a 10-minute talk.', '/run/report/deck_outline')}`,

  ask() {
    const chats = recs('chat').slice(-15).reverse();
    return `<div class="card"><h2>Ask the copilot</h2>
      <p class="hint">Ask anything about this company; it answers from everything in the tool and searches the web when needed.</p>
      <textarea id="askQ" placeholder="e.g. Which city should we test regional-language content in first, and why?"></textarea>
      <div class="row"><label class="meta"><input type="checkbox" id="askGround" checked> use Google Search</label><button id="askBtn">Ask</button></div></div>
      <div class="chat">${chats.map((c) => `<div class="card msg"><div class="you">${esc(c.data.question)}</div><div class="md">${md(c.data.answer)}</div>${sourcesHtml(c.data.sources)}<div class="row"><button class="small danger" data-del="${c.id}">Delete</button></div></div>`).join('')}</div>`;
  },
};

// ---------------- Growth OS ----------------
const prettyKey = (k) => {
  const m = state.catalog.modules.find((x) => `g_${x.key}` === k);
  if (m) return m.title;
  if (k === 'g_growth_model') return 'Growth model';
  if (k.startsWith('skill_')) return `Skill: ${k.slice(6)}`;
  return k.replace(/_/g, ' ');
};

function outputBlock(a) {
  if (!a) return '<p class="meta">Not run yet.</p>';
  return `<div class="row"><span class="meta">Generated ${new Date(a.data.generated_at).toLocaleString()} ${a.data.model ? `· ${esc(a.data.model)}` : ''}</span>${dlButtons(`record-${a.id}`)}</div>
    <details ${a.data.text.length < 2500 ? 'open' : ''}><summary>Output</summary><div class="md">${md(a.data.text)}</div>${sourcesHtml(a.data.sources)}</details>`;
}

function growthModelCard() {
  const a = artifact('g_growth_model');
  const saved = a?.data.inputs || {};
  const srcs = a?.data.input_sources || {};
  const prev = state.modelPreview;
  return `<div class="card"><h2>Growth model &amp; unit economics</h2>
    <p class="hint">Enter what you know and where each number came from (CEO answer, case PDF, or assumption). The app does the maths (GMV, contribution per order, LTV, CAC, payback, months to target); the AI only interprets it. Blank inputs show up as gaps.</p>
    <table class="simple"><tr><th>Input</th><th>Value</th><th>Source</th></tr>
    ${state.catalog.modelInputs.map(([k, l]) => `<tr><td>${esc(l)}</td><td><input data-mi="${k}" value="${esc(saved[k] ?? '')}" size="10" inputmode="decimal"></td><td><input data-ms="${k}" value="${esc(srcs[k] ?? '')}" placeholder="e.g. CEO answer" class="grow"></td></tr>`).join('')}</table>
    <div class="row"><button class="ghost" id="modelCalc">Calculate</button><button id="modelRun">Calculate + interpret with AI</button></div>
    ${prev ? `<table class="simple"><tr><th>Metric</th><th>Value</th><th>Formula</th></tr>${prev.outputs.map((o) => `<tr><td>${esc(o.label)}</td><td>${o.value == null ? '—' : `${o.value.toLocaleString('en-IN')} ${esc(o.unit)}`}</td><td class="meta">${esc(o.formula)}</td></tr>`).join('')}</table>${prev.missing.length ? `<p class="meta">Missing: ${prev.missing.map(esc).join(', ')}</p>` : ''}` : ''}
    ${outputBlock(a)}</div>`;
}

function growthModuleCard(m) {
  const a = artifact(`g_${m.key}`);
  const arts = state.records.filter((r) => r.kind === 'artifact' && r.key !== 'g_red_team');
  let inputHtml = '';
  if (m.input) inputHtml = m.input.big
    ? `<label class="meta">${esc(m.input.label)}</label><textarea id="gin-${m.key}" style="min-height:140px" placeholder="${esc(m.input.placeholder)}">${esc(a?.data.input || '')}</textarea>`
    : `<div class="row"><input id="gin-${m.key}" class="grow" placeholder="${esc(m.input.label)} — ${esc(m.input.placeholder)}" value="${esc(a?.data.input || '')}"></div>`;
  if (m.artifactInput) inputHtml = `<div class="row"><select id="gart-${m.key}">${arts.map((r) => `<option value="${esc(r.key)}" ${r.key === a?.data.critiqued ? 'selected' : ''}>${esc(prettyKey(r.key))}</option>`).join('') || '<option value="">Run another module first</option>'}</select></div>`;
  return `<div class="card"><div class="row"><h2 style="flex:1">${esc(m.title)}</h2>${m.grounded ? '<span class="tag">web search</span>' : ''}${m.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
    <p class="hint">${esc(m.desc)}</p>${inputHtml}
    <div class="row"><button data-grun="${m.key}">${a ? 'Re-run' : 'Run'}</button></div>
    ${outputBlock(a)}</div>`;
}

TABS.growth = () => {
  const groups = [...new Set(state.catalog.modules.map((m) => m.group))];
  const done = state.catalog.modules.filter((m) => artifact(`g_${m.key}`)).length;
  return `<div class="card"><h2>Growth OS</h2><p class="hint">The head-of-growth toolkit: ${state.catalog.modules.length} modules built on the marketingskills library. Each one uses everything the tool already knows: facts, CEO answers, research, competitors, content data and experiments. ${done}/${state.catalog.modules.length} run.</p>
    <div class="row">${groups.map((g) => `<a href="#grp-${g.replace(/\W+/g, '')}" class="tag">${esc(g)}</a>`).join('')}</div></div>
    ${groups.map((g) => `<h2 id="grp-${g.replace(/\W+/g, '')}" style="margin:24px 0 10px">${esc(g)}</h2>${g === 'Strategy & metrics' ? growthModelCard() : ''}${state.catalog.modules.filter((m) => m.group === g).map(growthModuleCard).join('')}`).join('')}`;
};

TABS.skills = () => {
  const outs = state.records.filter((r) => r.kind === 'artifact' && r.key.startsWith('skill_'));
  return `<div class="card"><h2>Skill lab</h2>
    <p class="hint">Run any of the ${state.catalog.skills.length} skills in the marketingskills library on this company. For example: <i>copywriting</i> for a new homepage hero, <i>marketing-psychology</i> to audit the guarantee wording, or <i>sales-enablement</i> for a one-pager for the founders. Outputs are saved and feed the other modules.</p>
    <div class="row"><select id="skillPick">${state.catalog.skills.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} · ${esc(s.title)}</option>`).join('')}</select>
      <label class="meta"><input type="checkbox" id="skillGround"> use web search</label></div>
    <textarea id="skillBrief" placeholder="What should this skill produce for ${esc(state.project.name)}?"></textarea>
    <div class="row"><button id="skillRun">Run skill</button></div></div>
    <div class="card"><h2>Skill outputs (${outs.length})</h2>
    ${outs.map((a) => `<details><summary>${esc(a.key.slice(6))} <span class="meta">${new Date(a.data.generated_at).toLocaleString()}</span></summary><p class="meta">Brief: ${esc(a.data.brief || '')}</p><div class="md">${md(a.data.text)}</div>${sourcesHtml(a.data.sources)}<div class="row"><button class="small danger" data-del="${a.id}">Delete</button></div></details>`).join('') || '<p class="meta">None yet.</p>'}</div>`;
};

// ---------------- Knowledge hub ----------------
function spark(values, { invert = false, w = 140, h = 34 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => {
    const y = invert ? ((x - min) / span) : 1 - ((x - min) / span);
    return `${((i / (v.length - 1)) * (w - 4) + 2).toFixed(1)},${(y * (h - 6) + 3).toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const pctTag = (p) => (p == null ? '<span class="meta">—</span>' : `<span class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`);
const motTag = (m) => (m ? `<span class="tag mot-${esc(m)}">${esc(m)}</span>` : '');

function kbBlock(r, body) {
  return `<details class="kb" ${r._open ? 'open' : ''}><summary>${esc(r.data.topic)} <span class="meta">${new Date(r.data.generated_at).toLocaleDateString()}</span></summary>
    ${body}${sourcesHtml(r.data.sources)}
    <div class="row"><button class="small danger" data-del="${r.id}">Delete</button></div></details>`;
}

const KB_RENDER = {
  insights: (r) => kbBlock(r, `<div class="kgrid">${(r.data.cards || []).map((c) => `<div class="kcard">
      <div class="kstat">${esc(c.stat)}</div><div class="khead">${esc(c.insight)}</div>
      <div class="meta">${esc(c.publisher)} · ${esc(c.date)} ${citeLinks(c.sources)}</div>
      <div class="kso"><b>So what:</b> ${esc(c.so_what)}</div>${motTag(c.motivation)}</div>`).join('')}</div>`),
  library: (r) => kbBlock(r, `<div class="kgrid">${(r.data.cards || []).map((c) => `<div class="kcard">
      <div class="khead">${esc(c.brand)} <span class="meta">${esc(c.year)}</span></div>
      <div class="kcamp">${esc(c.campaign)}</div>
      <p><b>What they did:</b> ${esc(c.tactic)}</p><p><b>Why it worked:</b> ${esc(c.why_it_worked)}</p>
      <p class="meta"><b>Result:</b> ${esc(c.result)}</p>
      ${c.sources?.length ? `<div class="kcite">Read more: ${citeLinks(c.sources)}</div>` : ''}
      <div class="kso"><b>Steal for ${esc(state.project.name)}:</b> ${esc(c.lesson)}</div>
      <span class="tag">${esc(c.channel)}</span>${motTag(c.motivation)}</div>`).join('')}</div>`),
  trends: (r) => kbBlock(r, `
      <table class="simple"><tr><th>Topic</th><th>Wikipedia views, last 24 months</th><th>Avg / month (last 3)</th><th>Year on year</th><th>vs previous 3 months</th></tr>
      ${(r.data.checks || []).map((c) => `<tr><td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.term)}</a>` : esc(c.term)}</td>
        <td>${c.error ? `<span class="meta">${esc(c.error)}</span>` : `<span class="trend-line">${spark(c.series.map((s) => s.views))}</span>`}</td>
        <td>${c.monthly_avg_last3?.toLocaleString('en-IN') ?? '—'}</td><td>${pctTag(c.growth_yoy_pct)}</td><td>${pctTag(c.momentum_pct)}</td></tr>`).join('')}</table>
      <p class="meta">Wikipedia views measure attention, not searches or sales, and are falling across the board as AI answers replace clicks. Compare topics with each other rather than reading a drop as decline.</p>
      ${r.data.scout ? `<h3>Why each is rising</h3><table class="simple"><tr><th>Topic</th><th>Evidence</th><th>Relevance</th></tr>${r.data.scout.items.map((i) => `<tr><td>${esc(i.term)}</td><td>${esc(i.why_rising)} <span class="meta">(${esc(i.evidence_date)})</span> ${citeLinks(i.sources)}</td><td>${esc(i.relevance)}</td></tr>`).join('')}</table>` : ''}`),
  traffic: (r) => kbBlock(r, `
      <table class="simple"><tr><th>Domain</th><th>Tranco rank</th><th>Rank, last 30 days</th><th>Change in 30 days</th></tr>
      ${(r.data.rows || []).map((x) => `<tr><td><b>${esc(x.domain)}</b></td>
        <td>${x.rank ? `#${x.rank.toLocaleString('en-IN')}` : `<span class="meta">${esc(x.error || 'not in top 1M')}</span>`}</td>
        <td><span class="trend-line">${spark((x.series || []).map((s) => s.rank), { invert: true })}</span></td>
        <td>${x.change == null ? '—' : `<span class="delta ${x.change >= 0 ? 'up' : 'down'}">${x.change >= 0 ? '▲' : '▼'} ${Math.abs(x.change).toLocaleString('en-IN')} places</span>`}</td></tr>`).join('')}</table>
      <p class="meta">Lower rank = more traffic. Tranco blends several top-sites lists into one ranking; it is a relative signal, not visitor counts.</p>`),
};

const KB_SECTIONS = [
  ['insights', 'Consumer insights', 'Like Think with Google: sourced stats about how Indians buy, sell and decide, each with a "so what" for this company.', 'Topic', 'e.g. how Indians buy used phones online', 'Find insights'],
  ['library', 'Campaign library', 'Like Marketing Examples and Because of Marketing: real campaigns broken down into what they did, why it worked and what to steal. Linked to sources, never copied.', 'Theme', 'e.g. building trust for second-hand products', 'Find campaigns'],
  ['trends', 'Trends', 'Like Exploding Topics: rising topics found through search, then checked against real monthly Wikipedia views. Or type your own terms to check.', 'Topic to scout', 'e.g. recommerce and thrifting in India', 'Scout trends'],
  ['traffic', 'Traffic', 'Like Similarweb: compare websites on Tranco, a free research ranking of the top 1M sites, with 30-day movement.', 'Domains', 'circlestore.in, olx.in, cashify.in, spinny.com', 'Compare'],
];

TABS.knowledge = () => {
  const kb = recs('kb').slice().reverse();
  return `<div class="card khero"><h2>Knowledge hub</h2>
    <p class="hint">The research library for ${esc(state.project.name)}. Every result is saved and fed into the other modules, so briefs, decks and experiments can cite it. All sources are free. Check figures against their source before quoting them.</p>
    <div class="row">${KB_SECTIONS.map(([k, t]) => `<a href="#kb-${k}" class="tag">${t} (${kb.filter((r) => r.data.type === k).length})</a>`).join('')}</div></div>
    ${KB_SECTIONS.map(([k, title, hint, label, ph, btn]) => {
      const mine = kb.filter((r) => r.data.type === k);
      if (mine[0]) mine[0]._open = true;
      return `<div class="card" id="kb-${k}"><h2>${title}</h2><p class="hint">${hint}</p>
        <div class="row"><input id="kbq-${k}" class="grow" placeholder="${esc(label)}: ${esc(ph)}">
        ${k === 'trends' ? '<input id="kbterms" class="grow" placeholder="Optional: your own terms, comma separated">' : ''}
        <button data-kb="${k}">${btn}</button></div>
        ${mine.map((r) => KB_RENDER[k](r)).join('') || '<p class="meta">Nothing saved yet.</p>'}</div>`;
    }).join('')}`;
};

// ---------------- Creative studio (5-step creative strategy process) ----------------
const STAGES = ['Unaware', 'Problem aware', 'Solution aware', 'Product aware', 'Most aware'];
const adLibrary = (name) => `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&search_type=keyword_unordered&q=${encodeURIComponent(name)}`;

function researchChecklist() {
  const r = state.records;
  const art = (k) => r.some((x) => x.kind === 'artifact' && x.key === k);
  const owners = new Set(recs('post').map((p) => p.data.owner));
  const answered = recs('question').filter((q) => q.data.answer?.trim()).length;
  const groups = [
    ['Competitor research', [
      ['Competitor breakdowns', recs('competitor').length > 0, `${recs('competitor').length} done`, 'competitors'],
      ['Posts from your account and competitors', owners.size > 1, `${owners.size} accounts`, 'content'],
    ]],
    ['Brand research (the handover from the team)', [
      ['Verified facts', recs('fact').length > 0, `${recs('fact').length} facts`, 'setup'],
      ['CEO answers', answered > 0, `${answered} answered`, 'questions'],
      ['Company profile', art('company_profile'), '', 'company'],
    ]],
    ['Market research', [
      ['Market research', art('market_research'), '', 'market'],
      ['Community listening (reviews, Reddit, forums)', art('community_listening'), '', 'content'],
      ['Knowledge hub (insights, campaigns, trends)', recs('kb').length > 0, `${recs('kb').length} saved`, 'knowledge'],
    ]],
  ];
  const all = groups.flatMap((g) => g[1]);
  return { html: groups.map(([g, items]) => `<div><h3>${g}</h3>${items.map(([l, ok, d, tab]) => `<div class="check ${ok ? 'ok' : ''}"><span class="dot">${ok ? '✓' : ''}</span><span style="flex:1">${l} ${d ? `<span class="meta">${esc(d)}</span>` : ''}</span><button class="small ghost" data-tab="${tab}">${ok ? 'Open' : 'Do it'}</button></div>`).join('')}</div>`).join(''), done: all.filter((x) => x[1]).length, total: all.length };
}

function briefCard(b) {
  const d = b.data;
  const script = recs('script').find((s) => s.key === String(b.id));
  return `<div class="kcard brief ${d.status}">
    <div class="row" style="margin:0"><span class="tag">${esc(d.awareness_stage)}</span>${motTag(d.motivation)}<span class="tag">${esc(d.platform)}</span>
      <select data-bstatus="${b.id}" style="margin-left:auto">${['draft', 'approved', 'rejected'].map((s) => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="khead">${esc(d.concept)}</div>
    <div class="hook">“${esc(d.hook)}”</div>
    <p><b>Avatar:</b> ${esc(d.avatar)} · <b>Trigger:</b> ${esc(d.trigger)}</p>
    <p><b>Angle:</b> ${esc(d.angle)}</p>
    <p><b>Format:</b> ${esc(d.format)} · <b>CTA:</b> ${esc(d.cta)}</p>
    <p><b>Key message:</b> ${esc(d.key_message)}</p>
    <p class="${/^needs proof/i.test(d.proof || '') ? 'warnline' : ''}"><b>Proof:</b> ${esc(d.proof)}</p>
    <p class="meta"><b>Visuals:</b> ${esc(d.visual_direction)}</p>
    ${d.reference ? `<p class="meta"><b>Reference:</b> ${esc(d.reference)}</p>` : ''}
    <div class="row" style="margin:0"><button class="small danger" data-del="${b.id}">Delete</button>${script ? '<span class="meta">Script written ✓</span>' : ''}</div>
  </div>`;
}

function scriptBlock(b) {
  const s = recs('script').find((x) => x.key === String(b.id))?.data;
  const head = `<div class="row"><input id="tone-${b.id}" class="grow" placeholder="Tone and language, e.g. Hinglish, Gen Z, Bengaluru" value="${esc(s?.tone || '')}"><input id="dur-${b.id}" placeholder="Length, e.g. 30s" size="10"><button data-script="${b.id}">${s ? 'Rewrite' : 'Write script'}</button></div>`;
  if (!s) return `<details class="kb" open><summary>${esc(b.data.concept)}</summary>${head}<p class="meta">Not written yet.</p></details>`;
  return `<details class="kb"><summary>${esc(s.title || b.data.concept)} <span class="meta">${esc(s.platform)} · ${esc(s.duration)}</span></summary>${head}
    <p><b>Speaks to:</b> ${esc(s.audience_note)}</p>
    <p><b>Hook options</b></p><ol>${(s.hooks || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <table class="simple"><tr><th>Time</th><th>Visual</th><th>Audio</th><th>On-screen text</th><th>Edit note</th></tr>
    ${(s.scenes || []).map((x) => `<tr><td>${esc(x.time)}</td><td>${esc(x.visual)}</td><td>${esc(x.audio)}</td><td>${esc(x.on_screen_text)}</td><td class="meta">${esc(x.edit_note)}</td></tr>`).join('')}</table>
    <p><b>CTA:</b> ${esc(s.cta)}</p><p><b>Caption:</b> ${esc(s.caption)} <span class="meta">${(s.hashtags || []).map(esc).join(' ')}</span></p>
    <p><b>Shoot needs:</b> ${(s.shoot_needs || []).map(esc).join('; ')}</p>
    <p class="meta"><b>Proof used:</b> ${esc(s.proof_used)} · <b>Success metric:</b> ${esc(s.success_metric)}</p></details>`;
}

TABS.creative = () => {
  const research = researchChecklist();
  const avatar = artifact('cs_avatar');
  const briefs = recs('brief');
  const approved = briefs.filter((b) => b.data.status === 'approved');
  const scripts = recs('script');
  const steps = [
    ['Research', research.done >= 5], ['Audience & awareness', Boolean(avatar)], ['Brief', briefs.length > 0],
    ['Approval → Script', scripts.length > 0], ['Present', approved.length > 0 && approved.every((b) => scripts.some((s) => s.key === String(b.id)))],
  ];
  const goals = [...new Set(briefs.map((b) => b.data.goal))];
  const comps = recs('competitor').map((c) => c.key);
  return `<div class="card"><h2>Creative studio</h2>
    <p class="hint">The creative strategist's process, from research to a script the team can approve: research, audience and awareness stage, brief, approval, script, then present.</p>
    <div class="stepper">${steps.map(([l, ok], i) => `<a href="#cs-${i + 1}" class="step ${ok ? 'done' : ''}"><span class="n">${ok ? '✓' : i + 1}</span>${l}</a>`).join('')}</div></div>

  <div class="card" id="cs-1"><h2>1 · Research</h2>
    <p class="hint">Three kinds of research feed every brief: competitors, the brand itself, and the market. ${research.done}/${research.total} done. Each item links to the tab where you do it.</p>
    <div class="grid2">${research.html}</div>
    ${comps.length ? `<h3>Competitors' live ads</h3><p class="meta">Meta has no free ads API for India, so these open each brand's public Meta Ad Library page.</p><div class="row">${comps.map((c) => `<a class="tag" href="${adLibrary(c)}" target="_blank" rel="noopener">${esc(c)} ↗</a>`).join('')}</div>` : ''}
  </div>

  <div class="card" id="cs-2"><h2>2 · Audience avatar &amp; stage of awareness</h2>
    <p class="hint">Who we're talking to, in their own words (quotes from reviews and Reddit, with sources), and where they sit on the awareness ladder: ${STAGES.join(' → ')}. Scripts reuse the language bank so they sound like the audience, not like us.</p>
    <div class="row"><input id="csFocus" class="grow" placeholder="Optional focus, e.g. sellers in Hyderabad, or Gen Z buyers of used iPhones" value="${esc(avatar?.data.focus || '')}"><button data-cs="avatar">${avatar ? 'Re-run' : 'Build avatars'}</button></div>
    ${avatar ? outputBlock(avatar) : '<p class="meta">Not built yet.</p>'}
  </div>

  <div class="card" id="cs-3"><h2>3 · Ideation: the brief</h2>
    <p class="hint">Start from the campaign goal (a sale, a festive push, a city launch, retargeting), then concepts with angle, hook, format, proof, CTA and references. Set each concept to <b>approved</b> before scripting it. Proof only comes from your research; gaps show as "needs proof".</p>
    <div class="row"><input id="csGoal" class="grow" placeholder="Campaign goal, e.g. Diwali upgrade: sell your old phone, buy a verified one">
      <input id="csAud" placeholder="Audience (optional)"><select id="csPlat"><option value="">All organic platforms</option><option>Instagram Reels</option><option>YouTube Shorts</option><option>Reddit</option><option>LinkedIn</option></select>
      <select id="csCount"><option>4</option><option selected>6</option><option>8</option></select><button data-cs="brief">Write brief</button></div>
    ${goals.map((g) => `<h3>Goal: ${esc(g)}</h3><div class="kgrid">${briefs.filter((b) => b.data.goal === g).map(briefCard).join('')}</div>`).join('') || '<p class="meta">No concepts yet.</p>'}
  </div>

  <div class="card" id="cs-4"><h2>4 · Scripting</h2>
    <p class="hint">Only approved concepts can be scripted. Each script has hook options, a scene-by-scene table (visual, audio, on-screen text, edit notes), caption, shoot needs and the metric that says it worked. Write in the audience's tone, not yours.</p>
    ${approved.map(scriptBlock).join('') || '<p class="meta">Approve a concept in step 3 first.</p>'}
  </div>

  <div class="card" id="cs-5"><h2>5 · Present</h2>
    <p class="hint">One document for the client or your manager: who we're talking to, then each approved concept with its script, visuals, editing notes and references. Paste it into Google Docs or Notion.</p>
    <div class="row">${dlButtons('creative', 'Creative pack:')}<button class="small ghost" id="csCopy">Copy text</button>
      <span class="meta">${approved.length} approved · ${approved.filter((b) => scripts.some((s) => s.key === String(b.id))).length} scripted</span></div>
  </div>`;
};

function readModelInputs() {
  const inputs = {}, sources = {};
  document.querySelectorAll('[data-mi]').forEach((i) => { if (i.value.trim() !== '') inputs[i.dataset.mi] = i.value.replace(/[,₹\s]/g, ''); });
  document.querySelectorAll('[data-ms]').forEach((i) => { if (i.value.trim()) sources[i.dataset.ms] = i.value.trim(); });
  return { inputs, sources };
}

// ---------------- render & events ----------------
const PAGES = {
  setup: ['Setup', 'Company details, verified facts and connections'],
  questions: ['CEO questions', 'Clarifying questions for the founders, and their answers'],
  company: ['Company', 'What the company sells, traction, segments and positioning'],
  market: ['Market', 'Market size, categories, trust barriers and trends'],
  creative: ['Creative studio', 'Research → audience → brief → script → present'],
  knowledge: ['Knowledge hub', 'Consumer insights, campaign library, trends and traffic'],
  competitors: ['Competitors', 'What worked and what didn’t for competitors and brand analogs'],
  content: ['Content & posts', 'Posts collected, community listening and content analysis'],
  strategy: ['Brand & expansion', 'National positioning, localisation and where to expand'],
  experiments: ['Experiments', 'Live growth experiments, results and reviews'],
  growth: ['Growth OS', 'The head-of-growth toolkit'],
  skills: ['Skill lab', 'Run any skill from the marketingskills library'],
  reports: ['Reports', 'Insight doc, solution doc, playbook and deck outline'],
  ask: ['Ask', 'Ask anything about this company'],
};

function renderKpis() {
  if (!state.project) return ($('#kpis').innerHTML = '');
  const qs = recs('question');
  const answered = qs.filter((q) => q.data.answer?.trim()).length;
  const growthDone = state.catalog.modules.filter((m) => artifact(`g_${m.key}`)).length;
  const cards = [
    ['Verified facts', recs('fact').length, '', 'setup'],
    ['CEO answers', answered, `/ ${qs.length}`, 'questions'],
    ['Competitors researched', recs('competitor').length, '', 'competitors'],
    ['Posts collected', recs('post').length, '', 'content'],
    ['Growth modules run', growthDone, `/ ${state.catalog.modules.length}`, 'growth'],
  ];
  $('#kpis').innerHTML = cards.map(([l, v, suf, tab]) => `<button class="kpi" data-tab="${tab}"><span class="k-label">${l}</span><span class="k-value">${v}<small>${suf}</small></span></button>`).join('');
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const [title, sub] = PAGES[state.tab] || ['', ''];
  $('#pageTitle').textContent = state.project ? title : 'Welcome';
  $('#pageSub').textContent = state.project ? `${state.project.name} · ${sub}` : 'Create a project to begin';
  document.title = `${title} · GTM Copilot`;
  const s = state.status;
  $('#status').innerHTML = `<span class="pill ${s.gemini ? 'ok' : 'no'}">Gemini</span><span class="pill ${s.youtube ? 'ok' : 'no'}">YouTube</span><span class="pill ${s.storage === 'neon' ? 'ok' : 'no'}">${s.storage === 'neon' ? 'Neon' : 'Local storage'}</span>`;
  renderKpis();
  if (!state.project) {
    $('#main').innerHTML = `<div class="card"><h2>Start</h2><p class="hint">Create a project for any company, or load the Circle case (pre-filled with facts from the Mesa problem statement).</p>
      <div class="row"><button id="seedCircle">Load Circle case</button><button class="ghost" id="newProjectBtn2">New project</button></div></div>`;
    return;
  }
  $('#main').innerHTML = TABS[state.tab]();
}

async function loadProjects() {
  const list = await api('GET', '/api/projects');
  $('#projectSelect').innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">No projects</option>';
  if (!state.projectId && list.length) state.projectId = Number(localStorage.getItem('gtm.pid')) || list[0].id;
  if (state.projectId && !list.some((p) => p.id === state.projectId)) state.projectId = list[0]?.id || null;
  if (state.projectId) $('#projectSelect').value = state.projectId;
}

async function loadProject() {
  if (!state.projectId) { state.project = null; return render(); }
  const d = await api('GET', `/api/projects/${state.projectId}`);
  state.project = d.project;
  state.records = d.records;
  try { localStorage.setItem('gtm.pid', state.projectId); } catch {}
  render();
}

async function newProject() {
  const name = prompt('Company name?');
  if (!name) return;
  const p = await api('POST', '/api/projects', { name });
  state.projectId = p.id;
  state.tab = 'setup';
  await loadProjects();
  await loadProject();
}

const val = (id) => $(id)?.value.trim();

async function tearDown(names, group) {
  const prog = $('#compProgress');
  for (let i = 0; i < names.length; i++) {
    if (prog) prog.textContent = `Researching ${names[i]} (${i + 1}/${names.length})… each takes ~20–60s`;
    try { await api('POST', P('/run/competitor'), { name: names[i], group }); }
    catch (e) { toast(`${names[i]}: ${e.message}`, true); }
    await loadProject();
  }
  toast('Teardowns done. Now run the competitive landscape.');
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, [data-tab]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; return render(); }
  const id = t.id;

  if (t.dataset.run) return run(t, () => api('POST', P(t.dataset.run)), t.dataset.msg);
  if (t.dataset.grun) {
    const k = t.dataset.grun;
    return run(t, () => api('POST', P(`/growth/${k}`), { input: $(`#gin-${k}`)?.value || '', artifactKey: $(`#gart-${k}`)?.value || '' }), 'Done');
  }
  if (t.dataset.dl) {
    const label = t.textContent; t.disabled = true; t.classList.add('spin');
    try { await downloadDoc(t.dataset.dl, t.dataset.fmt); } catch (e) { toast(e.message, true); }
    finally { t.disabled = false; t.classList.remove('spin'); t.textContent = label; }
    return;
  }
  if (t.dataset.cs === 'avatar') return run(t, () => api('POST', P('/creative/avatar'), { focus: val('#csFocus') }), 'Avatars ready');
  if (t.dataset.cs === 'brief') {
    if (!val('#csGoal')) return toast('Write the campaign goal first', true);
    return run(t, () => api('POST', P('/creative/brief'), { goal: val('#csGoal'), audience: val('#csAud'), platform: val('#csPlat'), count: Number(val('#csCount')) }), 'Brief ready: approve the concepts you like');
  }
  if (t.dataset.script) return run(t, () => api('POST', P(`/creative/script/${t.dataset.script}`), { tone: val(`#tone-${t.dataset.script}`), duration: val(`#dur-${t.dataset.script}`) }), 'Script ready');
  if (id === 'csCopy') {
    const r = await fetch(P('/doc/creative.md'));
    await navigator.clipboard.writeText(await r.text());
    return toast('Creative pack copied');
  }
  if (t.dataset.kb) {
    const k = t.dataset.kb;
    const q = val(`#kbq-${k}`);
    const body = k === 'traffic' ? { domains: (q || '').split(',') }
      : k === 'trends' ? { topic: q, terms: (val('#kbterms') || '').split(',') } : { topic: q };
    return run(t, () => api('POST', P(`/kb/${k}`), body), 'Saved to the knowledge hub');
  }
  if (t.dataset.del) { if (confirm('Delete this item?')) { await api('DELETE', `/api/records/${t.dataset.del}`); await loadProject(); } return; }

  switch (id) {
    case 'newProjectBtn': case 'newProjectBtn2': return newProject();
    case 'seedCircle': return run(t, async () => { const p = await api('POST', '/api/seed/circle'); state.projectId = p.id; await loadProjects(); }, 'Circle case loaded');
    case 'saveProject': return run(t, () => api('PUT', `/api/projects/${state.projectId}`, { name: val('#pName'), website: val('#pWeb'), description: val('#pDesc') }).then(loadProjects), 'Saved');
    case 'delProject':
      if (!confirm(`Delete project "${state.project.name}" and all its data?`)) return;
      await api('DELETE', `/api/projects/${state.projectId}`); state.projectId = null; await loadProjects(); return loadProject();
    case 'addFact':
      if (!val('#factText')) return;
      return run(t, () => api('POST', P('/records'), { kind: 'fact', data: { text: val('#factText'), source: val('#factSrc') || 'unspecified' } }));
    case 'addQ':
      if (!val('#newQ')) return;
      return run(t, () => api('POST', P('/records'), { kind: 'question', data: { question: val('#newQ'), category: 'Added by team', priority: 'high', answer: '', status: 'open' } }));
    case 'copyTop': case 'copyAll': {
      const qs = recs('question').filter((q) => id === 'copyAll' || q.data.priority === 'top');
      const text = `Hi! Ahead of our work on ${state.project.name}, a few questions:\n\n${qs.map((q, i) => `${i + 1}. ${q.data.question}`).join('\n')}\n\nThank you!`;
      await navigator.clipboard.writeText(text); return toast(`Copied ${qs.length} questions`);
    }
    case 'discover': return run(t, async () => { const d = await api('POST', P('/run/discover-competitors')); state.discovered = d.competitors || []; }, 'Suggestions ready — pick and tear down');
    case 'runDisc': {
      const picks = [...document.querySelectorAll('[data-disc]')].filter((c) => c.checked).map((c) => state.discovered[c.dataset.disc]);
      t.disabled = true;
      for (const g of ['direct', 'indirect', 'brand-analog']) { const n = picks.filter((p) => p.type === g).map((p) => p.name); if (n.length) await tearDown(n, g); }
      state.discovered = []; return render();
    }
    case 'runComps': { const names = val('#compNames').split(',').map((s) => s.trim()).filter(Boolean); if (!names.length) return; t.disabled = true; return tearDown(names, val('#compGroup')); }
    case 'analogs': t.disabled = true; return tearDown(['Meesho', 'Blinkit', 'Zepto', 'Flipkart'], 'brand-analog');
    case 'importCsv': return run(t, () => api('POST', P('/posts/csv'), { csv: $('#csv').value, owner: val('#csvOwner') }).then((r) => toast(`Imported ${r.imported} posts`)));
    case 'ytFetch': return run(t, () => api('POST', P('/posts/youtube-channel'), { channel: val('#ytChannel'), owner: val('#ytOwner') }).then((r) => toast(`${r.channel.title}: ${r.imported} videos${r.channel.subscribers != null ? `, ${r.channel.subscribers.toLocaleString()} subscribers` : ' (public feed, latest 15)'}`)));
    case 'ytSearch': return run(t, () => api('POST', P('/posts/youtube-search'), { query: val('#ytQuery') }).then((r) => toast(`Imported ${r.imported} videos`)));
    case 'rdFetch': return run(t, () => api('POST', P('/posts/reddit'), { query: val('#rdQuery') }).then((r) => toast(r.listening ? 'Reddit blocked anonymous access — community listening report generated instead' : `Imported ${r.imported} threads`)));
    case 'modelCalc': { const { inputs } = readModelInputs(); state.modelPreview = await api('POST', '/api/growth-model/compute', { inputs }); return render(); }
    case 'modelRun': { const { inputs, sources } = readModelInputs(); state.modelPreview = await api('POST', '/api/growth-model/compute', { inputs }); return run(t, () => api('POST', P('/growth-model'), { inputs, sources }), 'Growth model interpreted'); }
    case 'skillRun': if (!val('#skillBrief')) return toast('Write a brief first', true); return run(t, () => api('POST', P(`/skill/${val('#skillPick')}`), { brief: val('#skillBrief'), grounded: $('#skillGround').checked }), 'Skill output saved');
    case 'askBtn': if (!val('#askQ')) return; return run(t, () => api('POST', P('/ask'), { question: val('#askQ'), grounded: $('#askGround').checked }));
  }
  if (t.dataset.recomp) { t.disabled = true; return tearDown([t.dataset.recomp], t.dataset.group); }
  if (t.dataset.delowner) { if (!confirm(`Remove all posts from ${t.dataset.delowner}?`)) return; for (const p of recs('post').filter((p) => p.data.owner === t.dataset.delowner)) await api('DELETE', `/api/records/${p.id}`); return loadProject(); }
  if (t.dataset.review) return run(t, () => api('POST', P(`/run/experiment-review/${t.dataset.review}`)), 'Review ready');
  if (t.dataset.additer) {
    const row = document.querySelector(`[data-iter="${t.dataset.additer}"]`);
    const it = Object.fromEntries([...row.querySelectorAll('input')].map((i) => [i.name, i.value.trim()]));
    it.date = new Date().toISOString().slice(0, 10);
    const e = state.records.find((r) => r.id === Number(t.dataset.additer));
    return run(t, () => api('PUT', `/api/records/${e.id}`, { iterations: [...(e.data.iterations || []), it], status: 'running' }), 'Logged');
  }
});

// Save answers / selects on change.
document.addEventListener('change', async (ev) => {
  const el = ev.target;
  try {
    if (el.dataset.answer) { await api('PUT', `/api/records/${el.dataset.answer}`, { answer: el.value, status: el.value.trim() ? 'answered' : 'open' }); toast('Answer saved'); }
    else if (el.dataset.prio) await api('PUT', `/api/records/${el.dataset.prio}`, { priority: el.value });
    else if (el.dataset.status) await api('PUT', `/api/records/${el.dataset.status}`, { status: el.value });
    else if (el.dataset.bstatus) { await api('PUT', `/api/records/${el.dataset.bstatus}`, { status: el.value }); toast(`Concept ${el.value}`); return loadProject(); }
    else if (el.id === 'projectSelect') { state.projectId = Number(el.value); return loadProject(); }
    else return;
    const r = state.records.find((x) => x.id === Number(el.dataset.answer || el.dataset.prio || el.dataset.status));
    if (r) { if (el.dataset.answer) r.data.answer = el.value; if (el.dataset.prio) r.data.priority = el.value; if (el.dataset.status) r.data.status = el.value; }
  } catch (e) { toast(e.message, true); }
});

(async () => {
  try { state.status = await api('GET', '/api/status'); state.catalog = await api('GET', '/api/growth/catalog'); } catch (e) { toast(e.message, true); }
  await loadProjects();
  await loadProject();
})();
