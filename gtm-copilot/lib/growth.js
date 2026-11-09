// "Growth OS": the head-of-growth toolkit. A declarative registry of skill-backed modules,
// plus the pieces that need real computation (growth model) or special inputs (interviews, red team).
import { generate } from './gemini.js';
import { systemFor, listSkills, loadSkill } from './skills.js';
import * as db from './db.js';
import { crawlSite } from './sources.js';
import { buildContext, ROLE_ANALYST } from './modules.js';

const ROLE_HOG = `${ROLE_ANALYST}
You think like an elite Head of Growth: you pick ONE north star, tie every recommendation to a metric, size the effort (people, ₹, weeks), sequence by impact/effort, and say what you would NOT do. Organic-first; no paid spend unless asked. Output must be executable by a 2-person student team working with the founders.`;

// ---------- registry ----------
export const GROWTH_MODULES = [
  // Week 1
  { key: 'hypotheses', group: 'Week 1: hypotheses', title: 'Week-1 hypothesis tree', skills: ['customer-research', 'product-marketing', 'ab-testing'], withQuestions: true,
    desc: 'The problem in one sentence, a hypothesis tree (brand, consumer, geography, channels, content) with evidence for/against, the pending CEO question or experiment that validates each, and what you would do if it is wrong.',
    task: (n) => `Write ${n}'s Week-1 hypothesis document for the founders/mentor.
1. **The problem in one sentence** (sharp root problem the founder would agree with)
2. **Hypothesis tree**: one governing hypothesis, then 3-4 branches mirroring the brief (what the brand should stand for; which consumer motivation drives transactions; where localisation creates advantage; which organic channels/formats drive discovery-trust-transaction). Under each, 2-3 falsifiable sub-hypotheses.
3. For EVERY sub-hypothesis, a table row: | ID | Hypothesis ("We believe… because… we'll know we're right when…") | Evidence for | Evidence against | Confidence (L/M/H) | How to validate: pending CEO question (quote it from the pending list) / customer interview / live experiment | What we'd do if it's wrong |
4. **Riskiest assumptions** — top 3 to test first and why
5. **What competitors' wins and failures suggest** — which hypotheses are supported or challenged by them
6. **Validation plan for Weeks 2-3** — which interviews and experiments test which hypothesis IDs
Hypotheses must be specific to ${n} (would fail the "swap test" if you replaced the company name). Use only evidence in the context; mark gaps.` },

  // Strategy & metrics
  { key: 'north_star', group: 'Strategy & metrics', title: 'North Star & metrics tree', skills: ['analytics', 'marketing-plan'],
    desc: 'One North Star metric, the input metrics that drive it (buyer + seller side), a metrics tree, targets and the weekly dashboard spec.',
    task: (n) => `Define ${n}'s North Star Metric for a two-sided pre-owned marketplace (justify vs alternatives like GMV, transactions, verified listings). Build the metrics tree (acquisition → activation → liquidity → retention → referral) for BOTH buyers and sellers, with leading indicators, current value if known (else [Gap]) and how to measure each with free tools. End with a one-page weekly growth dashboard spec (metric, definition, source, owner, target).` },
  { key: 'growth_loops', group: 'Strategy & metrics', title: 'Growth loops & flywheel', skills: ['referrals', 'marketing-loops', 'community-marketing'],
    desc: 'Compounding loops (seller-supply, UGC/deal-content, referral, trust-review loops) instead of funnels, with the step that breaks each loop today.',
    task: (n) => `Design ${n}'s growth loops (not funnels). For each loop (e.g. seller lists → verified listing becomes content → buyer discovers → buyer becomes seller; referral; UGC unboxing/price-reveal; review/trust loop; city word-of-mouth): draw it step by step, the metric at each step, the weakest step today, the experiment that strengthens it, and expected compounding effect. Rank loops by fit for ${n}'s stage.` },
  { key: 'plan_90', group: 'Strategy & metrics', title: '90-day growth plan', skills: ['marketing-plan', 'marketing-ideas'],
    desc: 'AARRR-structured 90-day plan + 12-month roadmap: weekly milestones, owners, ₹ cost, expected impact and kill criteria.',
    task: (n) => `Write ${n}'s 90-day organic growth plan structured by AARRR, then a 12-month roadmap tied to funding milestones. Week-by-week for the first 4 weeks, then fortnightly. Each line: initiative, owner (founder/brand team/students/creators), cost ₹, metric moved, expected impact (with assumption), kill criteria. Include a "Not doing (and why)" list.` },
  { key: 'messaging', group: 'Strategy & metrics', title: 'Messaging house & copy bank', skills: ['copywriting', 'product-marketing', 'marketing-psychology'],
    desc: 'Umbrella promise, pillars per motivation (value, trust, discovery, convenience, circular), proof points, objection-handling lines and copy variants in English, Hindi/Hinglish and one regional language.',
    task: (n) => `Build ${n}'s messaging house: umbrella promise, 5 pillars (value, trust, discovery, convenience, circular consumption) each with proof points from the context (or [Gap]), objections and responses, words to use/avoid. Then a copy bank: for each pillar 5 hooks for Reels/Shorts, 3 headlines for the website, 2 WhatsApp-share lines, in English, Hinglish and one regional language (pick the language that fits the next expansion city; provide translations faithfully). Mark which variants to A/B test first.` },
  { key: 'offers', group: 'Strategy & metrics', title: 'Offers & guarantee framing', skills: ['offers', 'pricing', 'marketing-psychology'],
    desc: 'Buyer and seller offers that drive first transactions without discount addiction: guarantee framing, first-sale bonuses, price anchoring vs new.',
    task: (n) => `Design ${n}'s offer system without relying on heavy discounts: (1) buyer first-purchase offer, (2) seller first-listing offer, (3) how to frame the guarantee and verification for maximum trust (show 3 framings), (4) price anchoring vs new/retail and vs OLX/refurb, (5) urgency/scarcity that's honest for one-of-a-kind items, (6) what to test first and the metric.` },

  // Organic acquisition
  { key: 'content_calendar', group: 'Organic acquisition', title: '4-week content calendar', skills: ['content-strategy', 'social', 'video'],
    desc: 'Platform-by-platform calendar (Instagram, YouTube Shorts, Reddit, LinkedIn) with hooks, scripts, formats, motivation and city/language variants.',
    input: { label: 'Focus for this calendar (optional)', placeholder: 'e.g. launch in Hyderabad; test trust vs deals message' },
    task: (n, i) => `Create a 4-week organic content calendar for ${n}${i ? ` focused on: ${i}` : ''}. Table per week: day, platform, format, content pillar/motivation, hook (first 3 seconds), script outline or caption, CTA + UTM tag, city/language variant, experiment it feeds. Include 3 full Reel/Short scripts (shot list + on-screen text + VO) and 2 Reddit posts written in a native, non-promotional voice. Realistic for 2 people.` },
  { key: 'seo_plan', group: 'Organic acquisition', title: 'SEO & AI-search plan', skills: ['seo-audit', 'programmatic-seo', 'ai-seo', 'site-architecture', 'schema'], grounded: true, crawl: true,
    desc: 'Reads the site, finds intent keywords ("used iPhone 14 Bangalore", "sell PS5"), plans programmatic city × category × model pages and how to get cited by AI answers.',
    task: (n) => `SEO & AI-search plan for ${n}. Using the site text and search: (1) quick technical/on-page observations from the pages read (label what you could not check), (2) keyword themes by intent (buy-used, sell, price-check, is-it-safe) with Indian city/model modifiers — mark volumes as [Gap] unless sourced, (3) programmatic page system: templates (city × category, model price pages, "is X worth it used" guides) with data needed per page, (4) site architecture & internal linking, (5) schema to add (Product, Offer, Review, FAQ), (6) how to get cited in Google AI Overviews/ChatGPT/Gemini answers, (7) 30-day SEO sprint.` },
  { key: 'creator_program', group: 'Organic acquisition', title: 'Creator & influencer program', skills: ['influencer-marketing', 'social'], grounded: true,
    desc: 'Creator tiers (tech, thrift/sneaker, home, city creators), how to find them for free, briefs, outreach DMs, barter/affiliate deals and tracking.',
    task: (n) => `Design ${n}'s creator programme on a near-zero budget. (1) Creator archetypes that fit each category and city (tech unboxers, sneaker/thrift, home/interior, student, regional-language city creators) — find real examples via search with links and approximate follower size, labelled with date; (2) deal structures (barter with verified products, affiliate/referral code, seller-creator, paid only if proven); (3) a creator brief template; (4) 3 outreach DMs (English, Hinglish, regional); (5) tracking (codes, UTMs, landing pages); (6) a 4-week pilot with 5-10 micro-creators and success criteria.` },
  { key: 'community', group: 'Organic acquisition', title: 'Community program', skills: ['community-marketing', 'referrals'], grounded: true,
    desc: 'Where the buyers/sellers already gather (subreddits, college groups, WhatsApp/Telegram, gaming & camera clubs) and how Circle shows up usefully.',
    task: (n) => `Community strategy for ${n}: (1) where target buyers/sellers already gather online and offline in Indian cities (subreddits, Discord, college groups, WhatsApp/Telegram deal groups, camera/gaming/sneaker clubs, RWAs) — use search, link examples; (2) rules of engagement per community (what is welcome vs spam); (3) owned community option (e.g. "Circle Insiders" for power sellers / campus ambassadors) and whether it's worth it now; (4) a 30-day community playbook with weekly actions and metrics.` },
  { key: 'pr_plan', group: 'Organic acquisition', title: 'PR & earned media', skills: ['public-relations', 'link-building'], grounded: true,
    desc: 'Story angles (data stories on resale prices, circular economy, Bengaluru → India), target publications/newsletters and a pitch email.',
    task: (n) => `Earned-media plan for ${n}: (1) 6 story angles journalists would want (proprietary data stories e.g. resale value index by phone model, city trends, circular economy), (2) target publications, newsletters, podcasts and YouTube shows in India covering startups/consumer/tech/sustainability — via search, with links, (3) the data ${n} needs to own each story, (4) one press pitch email and one founder LinkedIn post, (5) timing hooks (festive season, iPhone launch cycle, Diwali clean-outs, campus move-out).` },
  { key: 'partnerships', group: 'Organic acquisition', title: 'Partnerships & co-marketing', skills: ['co-marketing', 'events'], grounded: true,
    desc: 'Supply and demand partners: colleges, corporates/offices (WFH chairs), movers & packers, repair shops, brands\' trade-in, fintech/UPI apps.',
    task: (n) => `Partnership map for ${n}: list partner types that unlock supply or demand (colleges/hostels, corporate offices & co-working, movers & packers, repair/service centres, residential societies, brand trade-ins, fintech/UPI cashback, sustainability orgs). For each: value exchange, example partners found via search (linked), effort, expected impact, first pilot. Recommend top 3 with a pilot plan.` },
  { key: 'aso', group: 'Organic acquisition', title: 'App store presence', skills: ['aso'], grounded: true,
    desc: 'Checks for Circle\'s app listings and competitors\', ratings/review themes, and listing improvements.',
    task: (n) => `App store review for ${n}: search for ${n}'s Android/iOS apps and main competitors' apps. Report: whether apps exist (with links), ratings and review counts (dated), top review themes, listing gaps (title, keywords, screenshots, description), and recommendations. If no app is found, say so and advise whether app vs mobile web is right at this stage.` },
  { key: 'free_tools', group: 'Organic acquisition', title: 'Free tools as marketing', skills: ['free-tools', 'lead-magnets', 'programmatic-seo'],
    desc: 'Engineering-as-marketing ideas such as a "what is my phone worth?" calculator or a used-gadget checklist, scored by effort and SEO/viral value.',
    task: (n) => `Propose 6 free tools / lead magnets for ${n} (e.g. resale-value calculator, used-phone inspection checklist, "is this a good deal?" checker, city price index). Score each on effort, SEO value, shareability, supply/demand captured. Spec the top one: inputs, outputs, data source, page copy, distribution, and how it feeds listings or sign-ups.` },
  { key: 'city_launch', group: 'Organic acquisition', title: 'City launch kit', skills: ['launch', 'events', 'community-marketing'], grounded: true,
    input: { label: 'City', placeholder: 'e.g. Hyderabad' },
    desc: 'Organic launch kit for one city: local insights, language, creators, communities, events, seed-supply plan and day-by-day first 30 days.',
    task: (n, i) => `City launch kit for ${n} in ${i || 'the next recommended city'}: local insights via search (demographics, college/IT hubs, language mix, popular resale categories, local deal communities, festivals in next 90 days), localisation of the message, seed-supply plan (how to get the first 1,000 listings), local creators/communities to approach, an offline moment (pop-up/campus event), and a day-by-day first 30 days with metrics.` },

  // Conversion & activation
  { key: 'cro_audit', group: 'Conversion & activation', title: 'Website CRO audit', skills: ['cro', 'signup', 'onboarding', 'copywriting'], crawl: true,
    desc: 'Reads the website and audits the buy and sell funnels: first-impression clarity, trust signals, friction, copy. Gives prioritised fixes and A/B tests.',
    task: (n) => `CRO audit of ${n}'s website using the page text read. (1) 5-second test: is it clear what it is, for whom, why trust it? (2) buyer funnel and seller funnel friction points, (3) trust-signal inventory (guarantee, verification, reviews, counts, press) — present vs missing, (4) copy rewrites for hero, guarantee and sell CTA, (5) prioritised fix list (impact × effort) and 3 A/B tests with metrics. Say clearly what you could not see from text alone (visual design, app flows).` },
  { key: 'tracking_plan', group: 'Conversion & activation', title: 'Tracking & attribution plan', skills: ['analytics', 'conversion-tracking', 'attribution'],
    desc: 'UTM convention, event taxonomy, how to attribute organic posts/creators to sign-ups and transactions with free tools (GA4, link-in-bio, codes).',
    task: (n) => `Measurement plan so ${n}'s organic experiments can prove impact on visits, sign-ups and transactions using free tools: UTM convention (with examples per platform/creator/city/variant), event taxonomy (name, trigger, properties) for buy & sell flows, promo/referral codes, link-in-bio setup, how to attribute dark social/WhatsApp, a weekly reporting sheet layout, and pitfalls.` },

  // Retention & referral
  { key: 'lifecycle', group: 'Retention & referral', title: 'Lifecycle: WhatsApp, SMS & email', skills: ['sms', 'emails', 'onboarding', 'churn-prevention'],
    desc: 'Buyer and seller journeys: welcome, abandoned browse, listing nudges, post-purchase review, buyer→seller conversion, win-back, with message copy.',
    task: (n) => `Lifecycle programme for ${n} across WhatsApp (primary in India), SMS and email. Map buyer and seller journeys and write each flow: trigger, timing, channel, message copy (Hinglish-friendly), goal metric. Must include: welcome, browse/cart abandonment, first listing nudge, listing-quality tips, post-delivery review + guarantee reassurance, buyer→seller ("sell what you upgraded from"), referral ask, win-back. Respect DLT/WhatsApp template rules.` },
  { key: 'referral_program', group: 'Retention & referral', title: 'Referral program', skills: ['referrals', 'marketing-psychology', 'offers'],
    desc: 'Two-sided referral design for buyers and sellers: reward, trigger moments, mechanics, fraud guards, copy and success metrics.',
    task: (n) => `Design ${n}'s referral programme: who refers whom (buyer→buyer, seller→seller, buyer→seller), reward options compared (cash, credits, free pickup, priority verification) with unit-economics guardrails, trigger moments (right after a successful delivery/guarantee window), mechanics and share copy (WhatsApp first), fraud guards, metrics (K-factor, referral share of new users) and a 4-week test plan.` },

  // Research & operations
  { key: 'interview_kit', group: 'Research & operations', title: 'Customer interview & survey kit', skills: ['customer-research'],
    desc: 'Interview guides for buyers, sellers and non-users (past-behaviour questions), a 10-question survey, recruiting plan and note template.',
    task: (n) => `Primary-research kit for ${n}: (1) interview guides (buyers, sellers, people who considered but didn't transact, people in a non-Bengaluru city) — 30 min, past-behaviour questions, no leading questions; (2) a 10-question survey (Google Forms-ready) covering the five motivations, city, language, category, trust barriers; (3) recruiting plan (where to find 15-20 people in a week for free); (4) a note-taking template; (5) what result would change the brand recommendation.` },
  { key: 'interview_synthesis', group: 'Research & operations', title: 'Interview synthesis', skills: ['customer-research'],
    input: { label: 'Paste interview notes / transcripts / survey results', placeholder: 'Interview 1 — Riya, 24, Pune, bought used iPhone on OLX...\n...', required: true, big: true },
    desc: 'Paste your interview notes or survey results; get themes, jobs-to-be-done, motivation ranking by segment/city and verbatim quotes.',
    task: (n, i) => `Synthesise this primary research for ${n}. Use ONLY the notes below as evidence; quote verbatim with the respondent label. Output: themes (with count of respondents), jobs-to-be-done (functional/emotional/social), ranking of the five motivations by segment/city/language, trust barriers, surprises vs the earlier analysis, implications for brand and experiments, and gaps for the next interviews.\n\nNOTES:\n${i}` },
  { key: 'weekly_review', group: 'Research & operations', title: 'Weekly growth review', skills: ['ab-testing', 'marketing-loops', 'analytics'], withExperiments: true,
    input: { label: 'This week\'s numbers & notes (optional)', placeholder: 'Followers +320, site visits from IG 410, 6 sign-ups via code CIRCLE10...' },
    desc: 'The weekly ritual: what moved, experiment readouts, what we learned, decisions (scale/iterate/kill), next week\'s priorities and asks for the founders.',
    task: (n, i) => `Run ${n}'s weekly growth review. Inputs: experiments and their iterations (below), content analysis, and this week's notes: ${i || '(none provided)'}. Output: headline (one sentence), metrics vs last week/targets (only numbers given), experiment readouts, learnings, decisions (scale/iterate/kill), next week's top 3 priorities, asks/blockers for the founders, and a short update message to send the mentor.` },
  { key: 'red_team', group: 'Research & operations', title: 'Board-of-advisors critique', skills: ['marketing-council'], artifactInput: true,
    desc: 'A simulated board of legendary marketers critiques any output (positioning, plan, deck), surfacing weak spots before your mentor or the founders do.',
    task: (n, i, art) => `Act as the marketing council and stress-test this ${n} deliverable ("${art?.key}"). Each advisor: biggest flaw, the question the founder will ask, what to change. Then a consensus: top 5 fixes ranked, claims that need stronger evidence, and a rewritten one-line recommendation.\n\nDELIVERABLE:\n${art?.data?.text?.slice(0, 20000) || '(missing)'}` },
];

const byKey = Object.fromEntries(GROWTH_MODULES.map((m) => [m.key, m]));

export function growthCatalog() {
  return GROWTH_MODULES.map(({ key, group, title, desc, skills, grounded, input, artifactInput }) => ({ key, group, title, desc, skills, grounded: !!grounded, input: input || null, artifactInput: !!artifactInput }));
}

export async function runGrowthModule(pid, key, input = '', artifactKey = '') {
  const m = byKey[key];
  if (!m) throw new Error(`Unknown module ${key}`);
  if (m.input?.required && !String(input).trim()) throw new Error(`${m.title}: ${m.input.label} is required.`);
  const { project, ctx, recs } = await buildContext(pid, { exclude: `g_${key}` });
  let extra = '';
  if (m.crawl) {
    const site = await crawlSite(project.website, 6);
    extra += `\n## Website text read (${site.pages.length} pages)\n${site.pages.map((p) => `### ${p.url}\n${p.text}`).join('\n\n') || site.error}`;
  }
  if (m.withQuestions) {
    const qs = recs.filter((r) => r.kind === 'question' && !r.data.answer?.trim());
    extra += `\n## Pending questions sent to the CEO (answers not in yet)\n${qs.map((q) => `- [${q.data.priority}] ${q.data.question}`).join('\n') || '(none)'}`;
  }
  if (m.withExperiments) {
    const ex = recs.filter((r) => r.kind === 'experiment');
    extra += `\n## Experiments\n${ex.map((e) => `- ${e.data.name} [${e.data.status}] metric=${e.data.primary_metric} threshold=${e.data.success_threshold} iterations=${JSON.stringify(e.data.iterations || [])}`).join('\n') || '(none yet)'}`;
  }
  let art = null;
  if (m.artifactInput) {
    art = recs.find((r) => r.kind === 'artifact' && r.key === artifactKey);
    if (!art) throw new Error('Pick an output to critique.');
  }
  const out = await generate({
    system: systemFor(ROLE_HOG, m.skills),
    prompt: `${ctx}${extra}\n\nTASK: ${m.task(project.name, input, art)}\nLabel material claims [Observed]/[Inferred]/[Gap].`,
    grounded: !!m.grounded,
  });
  return db.saveArtifact(pid, `g_${key}`, { text: out.text, sources: out.sources, queries: out.queries, input, critiqued: artifactKey || undefined, model: out.model });
}

// ---------- Growth model (numbers computed here, not by the model) ----------
export const MODEL_INPUTS = [
  ['monthly_orders', 'Orders per month'], ['aov', 'Average order value (₹)'], ['take_rate_pct', 'Take rate (% of GMV)'],
  ['logistics_per_order', 'Pickup + delivery cost per order (₹)'], ['qc_per_order', 'Verification/QC cost per order (₹)'],
  ['payment_pct', 'Payment gateway cost (% of GMV)'], ['return_rate_pct', 'Return rate (%)'], ['return_cost', 'Cost per return (₹)'],
  ['new_buyers_month', 'New buyers per month'], ['repeat_orders_12m', 'Extra orders per buyer in 12 months'],
  ['monthly_marketing_cost', 'Monthly organic/marketing cost incl. creators (₹)'], ['monthly_visitors', 'Website visitors per month'],
  ['active_listings', 'Active listings'], ['monthly_sold_listings', 'Listings sold per month'],
  ['target_monthly_gmv_cr', 'Target monthly GMV (₹ Cr)'], ['mom_growth_pct', 'Assumed month-on-month growth (%)'],
];

export function computeGrowthModel(inp) {
  const v = (k) => (inp[k] === '' || inp[k] == null || isNaN(+inp[k]) ? null : +inp[k]);
  const out = [];
  const add = (label, value, formula, unit = '') => out.push({ label, value: value == null || !isFinite(value) ? null : Math.round(value * 100) / 100, unit, formula });
  const orders = v('monthly_orders'), aov = v('aov'), take = v('take_rate_pct');
  const gmv = orders != null && aov != null ? orders * aov : null;
  add('Monthly GMV', gmv, 'orders × AOV', '₹');
  add('Monthly GMV', gmv != null ? gmv / 1e7 : null, 'GMV ÷ 1 Cr', '₹ Cr');
  add('Annualised GMV', gmv != null ? (gmv * 12) / 1e7 : null, 'monthly GMV × 12', '₹ Cr');
  const revPerOrder = aov != null && take != null ? (aov * take) / 100 : null;
  add('Revenue per order', revPerOrder, 'AOV × take rate', '₹');
  add('Monthly net revenue', revPerOrder != null && orders != null ? revPerOrder * orders : null, 'revenue/order × orders', '₹');
  const varCost = [v('logistics_per_order'), v('qc_per_order')].every((x) => x != null) && aov != null
    ? v('logistics_per_order') + v('qc_per_order') + (aov * (v('payment_pct') || 0)) / 100 + ((v('return_rate_pct') || 0) / 100) * (v('return_cost') || 0)
    : null;
  add('Variable cost per order', varCost, 'logistics + QC + payment% × AOV + return rate × return cost', '₹');
  const contrib = revPerOrder != null && varCost != null ? revPerOrder - varCost : null;
  add('Contribution per order', contrib, 'revenue/order − variable cost', '₹');
  add('Contribution margin (of revenue)', contrib != null && revPerOrder ? (contrib / revPerOrder) * 100 : null, 'contribution ÷ revenue/order', '%');
  const ltv = contrib != null ? contrib * (1 + (v('repeat_orders_12m') || 0)) : null;
  add('12-month contribution LTV per buyer', ltv, 'contribution × (1 + repeat orders)', '₹');
  const cac = v('monthly_marketing_cost') != null && v('new_buyers_month') ? v('monthly_marketing_cost') / v('new_buyers_month') : null;
  add('Blended CAC', cac, 'marketing cost ÷ new buyers', '₹');
  add('LTV : CAC', ltv != null && cac ? ltv / cac : null, 'LTV ÷ CAC', 'x');
  add('Orders to pay back CAC', cac != null && contrib > 0 ? cac / contrib : null, 'CAC ÷ contribution/order', 'orders');
  add('Visit → order conversion', orders != null && v('monthly_visitors') ? (orders / v('monthly_visitors')) * 100 : null, 'orders ÷ visitors', '%');
  add('Monthly sell-through', v('monthly_sold_listings') != null && v('active_listings') ? (v('monthly_sold_listings') / v('active_listings')) * 100 : null, 'listings sold ÷ active listings', '%');
  const target = v('target_monthly_gmv_cr');
  add('Orders/month needed for target', target != null && aov ? (target * 1e7) / aov : null, 'target GMV ÷ AOV', 'orders');
  const g = v('mom_growth_pct');
  add('Months to reach target', target != null && gmv && g > 0 && target * 1e7 > gmv ? Math.log((target * 1e7) / gmv) / Math.log(1 + g / 100) : null, 'ln(target ÷ GMV) ÷ ln(1 + growth)', 'months');
  const missing = MODEL_INPUTS.filter(([k]) => v(k) == null).map(([, l]) => l);
  return { outputs: out, missing };
}

export async function runGrowthModel(pid, inputs, sources = {}) {
  const { project, ctx } = await buildContext(pid, { exclude: 'g_growth_model' });
  const { outputs, missing } = computeGrowthModel(inputs);
  const fmt = (o) => (o.value == null ? '—' : `${o.unit === '₹' ? '₹' : ''}${o.value.toLocaleString('en-IN')}${o.unit && o.unit !== '₹' ? ` ${o.unit}` : ''}`);
  const tableMd = `| Metric | Value | Formula |\n|---|---|---|\n${outputs.map((o) => `| ${o.label} | ${fmt(o)} | ${o.formula} |`).join('\n')}`;
  const inputsMd = `| Input | Value | Source |\n|---|---|---|\n${MODEL_INPUTS.filter(([k]) => inputs[k] !== '' && inputs[k] != null).map(([k, l]) => `| ${l} | ${inputs[k]} | ${sources[k] || 'assumption'} |`).join('\n')}`;
  const out = await generate({
    system: systemFor(ROLE_HOG, ['marketing-plan', 'pricing']),
    prompt: `${ctx}\n\n## Growth model inputs\n${inputsMd}\n\n## Computed by the app (exact — do not recalculate)\n${tableMd}\n\nMissing inputs: ${missing.join(', ') || 'none'}\n\nTASK: Interpret ${project.name}'s growth model as Head of Growth: health of unit economics, which 2-3 levers matter most (sensitivity: what a 10% change in each lever does, computed simply), what organic growth must deliver to hit the target, risks, which missing inputs to ask the founders for first, and how this should shape the experiments. Flag any input marked "assumption".`,
  });
  return db.saveArtifact(pid, 'g_growth_model', { text: `### Inputs\n${inputsMd}\n\n### Model\n${tableMd}\n\n---\n\n${out.text}`, inputs, input_sources: sources, outputs, sources: [], model: out.model });
}

// ---------- Run any skill in the library ----------
export function skillCatalog() {
  return listSkills().map((name) => {
    const raw = loadSkill(name);
    const h1 = raw.match(/^#\s+(.+)$/m)?.[1] || name;
    return { name, title: h1 };
  });
}

export async function runSkill(pid, skill, brief, grounded = false) {
  if (!listSkills().includes(skill)) throw new Error(`Unknown skill ${skill}`);
  if (!String(brief || '').trim()) throw new Error('Write a brief: what do you want this skill to produce?');
  const { project, ctx } = await buildContext(pid, { exclude: `skill_${skill}` });
  const out = await generate({
    system: systemFor(ROLE_HOG, [skill]),
    prompt: `${ctx}\n\nTASK (apply the "${skill}" skill for ${project.name}): ${brief}\nDeliver the finished output, not questions. Label claims [Observed]/[Inferred]/[Gap].`,
    grounded,
  });
  return db.saveArtifact(pid, `skill_${skill}`, { text: out.text, sources: out.sources, brief, model: out.model });
}
