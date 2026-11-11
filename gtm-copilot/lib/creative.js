// Creative studio: a creative strategist's 5-step process.
// 1 Research (reuses the rest of the tool) -> 2 Audience avatar + awareness stage ->
// 3 Brief (goal, concept, angle, hook, format, proof, CTA, references) + approval ->
// 4 Script in the audience's own words -> 5 Presentation pack for sign-off.
import { generate, generateJSON } from './gemini.js';
import { systemFor } from './skills.js';
import * as db from './db.js';
import { buildContext } from './modules.js';

const ROLE_CS = 'You are a senior creative strategist for Indian consumer brands. You turn research into briefs and short-form scripts that sound like the audience, not like a marketer. Evidence first: proof points must come from the context, never invented.';

const STAGES = ['Unaware', 'Problem aware', 'Solution aware', 'Product aware', 'Most aware'];

// ---------- Step 1: research checklist (computed, no AI) ----------
export async function researchStatus(pid) {
  const recs = await db.listRecords(pid);
  const art = (k) => recs.some((r) => r.kind === 'artifact' && r.key === k);
  const comps = recs.filter((r) => r.kind === 'competitor').map((r) => r.key);
  return {
    competitor: [
      { item: 'Competitor breakdowns', done: comps.length > 0, detail: `${comps.length} done`, tab: 'competitors' },
      { item: 'Posts from more than one account (yours + competitors)', done: new Set(recs.filter((r) => r.kind === 'post').map((r) => r.data.owner)).size > 1, detail: `${new Set(recs.filter((r) => r.kind === 'post').map((r) => r.data.owner)).size} accounts`, tab: 'content' },
    ],
    brand: [
      { item: 'Verified facts', done: recs.some((r) => r.kind === 'fact'), detail: `${recs.filter((r) => r.kind === 'fact').length} facts`, tab: 'setup' },
      { item: 'CEO answers (knowledge transfer)', done: recs.some((r) => r.kind === 'question' && r.data.answer?.trim()), detail: `${recs.filter((r) => r.kind === 'question' && r.data.answer?.trim()).length} answered`, tab: 'questions' },
      { item: 'Own posts and performance', done: recs.some((r) => r.kind === 'post'), detail: `${recs.filter((r) => r.kind === 'post').length} posts`, tab: 'content' },
      { item: 'Company profile', done: art('company_profile'), detail: '', tab: 'company' },
    ],
    market: [
      { item: 'Market research', done: art('market_research'), detail: '', tab: 'market' },
      { item: 'Community listening (reviews, Reddit, forums)', done: art('community_listening'), detail: '', tab: 'content' },
      { item: 'Knowledge hub (insights, campaigns, trends)', done: recs.some((r) => r.kind === 'kb'), detail: `${recs.filter((r) => r.kind === 'kb').length} saved`, tab: 'knowledge' },
    ],
    competitors: comps,
  };
}

// ---------- Step 2: audience avatar + stage of awareness ----------
export async function runAvatar(pid, focus = '') {
  const { project, ctx } = await buildContext(pid);
  const prompt = `${ctx}

TASK: Step 2 of the creative process for ${project.name}: audience avatars and stage of awareness.${focus ? ` Focus: ${focus}.` : ''}
Use the research above, and Google Search for real customer language (Reddit, Quora, app/Play Store and Google reviews, YouTube comments) about buying and selling used phones, gadgets and furniture in India.

## 1. Avatars (2-3, buyers and sellers)
For each: name + one-line description; who (age band, city tier, income, life moment); what they are trying to get done; pains; desires; objections to buying/selling used; what they tried before and why it failed; where they spend time online; generation and tone (Gen Z / millennial / older; English / Hinglish / regional).
Include a **"In their own words"** list of 5-8 real quotes or phrases found online, each with its source. Never invent quotes.

## 2. Awareness ladder
Table: | Stage | What this audience believes at this stage | The message that moves them up | Best format | Channel |
Rows: ${STAGES.join(', ')}.
Then say which stage most of ${project.name}'s target audience is at today and the evidence for it (label [Inferred] if reasoning).

## 3. Language bank
Words and phrases to use, and words to avoid (marketer-speak that this audience would not say).`;
  const out = await generate({ system: systemFor(ROLE_CS, ['customer-research', 'product-marketing', 'marketing-psychology']), prompt, grounded: true });
  return db.saveArtifact(pid, 'cs_avatar', { text: out.text, sources: out.sources, focus, model: out.model });
}

// ---------- Step 3: the brief ----------
export async function runBrief(pid, { goal, audience = '', platform = '', count = 6 }) {
  if (!goal?.trim()) throw new Error('Write the campaign goal first, e.g. "Diwali upgrade sale" or "get first 500 sellers in Hyderabad".');
  const { project, ctx, recs } = await buildContext(pid);
  if (!recs.some((r) => r.kind === 'artifact' && r.key === 'cs_avatar')) throw new Error('Run step 2 (audience avatar) first: the brief is built on it.');
  const prompt = `${ctx}

TASK: Step 3, the creative brief for ${project.name}.
Campaign goal: ${goal}
${audience ? `Audience: ${audience}` : 'Audience: pick from the avatars above.'}
${platform ? `Platform: ${platform}` : 'Platforms: Instagram Reels, YouTube Shorts, Reddit, LinkedIn (organic).'}
Write ${count} distinct concepts. Mix awareness stages and the five motivations (value, trust, discovery, convenience, circular).
Proof must come from the verified facts, CEO answers or research above; if none fits, write "needs proof: <what to get>".
References must be real campaigns or videos named in the context (campaign library, teardowns, posts); otherwise "".
Return ONLY JSON: {"concepts":[{"concept":"one-line idea","avatar":"which avatar","awareness_stage":"${STAGES.join('|')}","motivation":"value|trust|discovery|convenience|circular","trigger":"the moment or feeling that makes them care","angle":"","hook":"the first 2 seconds, spoken or on screen","format":"e.g. street interview, POV, before/after, founder talk, teardown, UGC testimonial","platform":"","key_message":"","proof":"","cta":"","visual_direction":"","reference":"brand/campaign or video and why"}]}`;
  const out = await generateJSON({ system: systemFor(ROLE_CS, ['ad-creative', 'social', 'copywriting', 'marketing-psychology']), prompt });
  const list = out.data.concepts || [];
  const saved = [];
  for (const c of list) saved.push(await db.addRecord(pid, 'brief', goal.trim().slice(0, 120), { ...c, goal: goal.trim(), status: 'draft', created_at: new Date().toISOString() }));
  return { added: saved.length };
}

// ---------- Step 4: script (only for approved concepts) ----------
export async function runScript(pid, briefId, { tone = '', duration = '' } = {}) {
  const brief = await db.getRecord(briefId);
  if (!brief || brief.kind !== 'brief') throw new Error('Brief not found');
  if (brief.data.status !== 'approved') throw new Error('Get this concept approved first (set it to "approved" in step 3), so you never script an idea nobody signed off.');
  const { project, ctx } = await buildContext(pid);
  const b = brief.data;
  const prompt = `${ctx}

TASK: Step 4, write the script for this APPROVED concept for ${project.name}.
${JSON.stringify(b, null, 1)}
${tone ? `Language and tone: ${tone}` : 'Language and tone: match the avatar\'s generation and the language bank above (e.g. Hinglish for Gen Z metro). Never the writer\'s own corporate voice.'}
${duration ? `Length: ${duration}` : 'Length: 30-45 seconds for short-form.'}
Use only proof that exists in the context. Write how people actually talk; use phrases from the language bank.
Return ONLY JSON:
{"title":"","platform":"","format":"","duration":"","audience_note":"who this speaks to and in what tone","hooks":["3 alternative opening lines"],
 "scenes":[{"time":"0-3s","visual":"what we see / shot","audio":"voiceover or dialogue, in the audience's language","on_screen_text":"","edit_note":"pacing, cuts, sound, captions"}],
 "cta":"","caption":"post caption in the same voice","hashtags":["…"],"shoot_needs":["props, people, locations, b-roll"],"proof_used":"which fact/research backs the claims","success_metric":"what number tells us it worked"}`;
  const out = await generateJSON({ system: systemFor(ROLE_CS, ['video', 'copywriting', 'social']), prompt, temperature: 0.7 });
  await db.deleteRecordsByKind(pid, 'script', String(briefId));
  return db.addRecord(pid, 'script', String(briefId), { ...out.data, brief_id: Number(briefId), tone, generated_at: new Date().toISOString(), model: out.model });
}

// ---------- Step 5: presentation pack (markdown, for sign-off) ----------
export async function creativePack(pid) {
  const p = await db.getProject(pid);
  const recs = await db.listRecords(pid);
  const avatar = recs.find((r) => r.kind === 'artifact' && r.key === 'cs_avatar');
  const briefs = recs.filter((r) => r.kind === 'brief' && r.data.status === 'approved');
  const scripts = new Map(recs.filter((r) => r.kind === 'script').map((r) => [Number(r.key), r.data]));
  const cell = (s = '') => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  let md = `# ${p.name}: creative pack for review\n\n_Prepared ${new Date().toISOString().slice(0, 10)}. Approved concepts with scripts, visuals and editing notes._\n\n`;
  if (avatar) md += `## Who we are talking to\n\n${avatar.data.text.split(/\n## 2\./)[0].replace(/^## 1\.[^\n]*\n/, '')}\n\n`;
  for (const b of briefs) {
    const d = b.data, s = scripts.get(b.id);
    md += `---\n\n## ${cell(s?.title || d.concept)}\n\n| Goal | Avatar | Stage | Motivation | Platform | Format |\n|---|---|---|---|---|---|\n| ${cell(d.goal)} | ${cell(d.avatar)} | ${cell(d.awareness_stage)} | ${cell(d.motivation)} | ${cell(d.platform)} | ${cell(d.format)} |\n\n`;
    md += `**Angle:** ${d.angle}  \n**Hook:** ${d.hook}  \n**Key message:** ${d.key_message}  \n**Proof:** ${d.proof}  \n**CTA:** ${d.cta}  \n**Visual direction:** ${d.visual_direction}  \n**Reference:** ${d.reference || '—'}\n\n`;
    if (s) {
      md += `**Tone:** ${s.audience_note}  \n**Length:** ${s.duration}\n\n**Alternative hooks**\n${(s.hooks || []).map((h) => `- ${h}`).join('\n')}\n\n`;
      md += `| Time | Visual | Audio | On-screen text | Edit note |\n|---|---|---|---|---|\n${(s.scenes || []).map((x) => `| ${cell(x.time)} | ${cell(x.visual)} | ${cell(x.audio)} | ${cell(x.on_screen_text)} | ${cell(x.edit_note)} |`).join('\n')}\n\n`;
      md += `**Caption:** ${s.caption}  \n**Hashtags:** ${(s.hashtags || []).join(' ')}  \n**Shoot needs:** ${(s.shoot_needs || []).join('; ')}  \n**Proof used:** ${s.proof_used}  \n**Success metric:** ${s.success_metric}\n\n`;
    } else md += `_Script not written yet._\n\n`;
  }
  if (!briefs.length) md += '_No approved concepts yet. Approve concepts in step 3._\n';
  return md;
}
