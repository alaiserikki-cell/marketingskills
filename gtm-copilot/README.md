# GTM Copilot

An end-to-end growth & GTM research tool built on top of the [marketingskills](../README.md) library.
Give it a company. It researches the company, the market and the competitors, drafts the questions to send the CEO, takes the CEO's answers back in, analyses posts, designs and reviews live experiments, and writes the deliverables.

Every module loads the matching `skills/*/SKILL.md` files from this repo as expert instructions for Gemini, so the frameworks (product-marketing, competitor-profiling, reverse-engineer-marketing, customer-research, social, ab-testing, marketing-plan, …) drive the analysis.

**100% free stack:** Gemini API free tier (with Google Search grounding for sourced research), YouTube Data API (free quota), Neon Postgres free tier (or a local JSON file), Node + Express. Nothing paid.

## Modules

| Tab | What it does | Skills used |
|---|---|---|
| CEO questions | 20–25 questions that can't be answered by a quick search, 5 starred to send first; paste answers back; "what the answers change" | customer-research, product-marketing |
| Company | Reads the website + web search → product, traction, segments, positioning, channel footprint, sourced fact sheet, gaps | product-marketing, customer-research |
| Market | Market definition, TAM/SAM/SOM with method, categories, trust barriers, geography, trends | marketing-plan, customer-research |
| Competitors | Suggests competitors; teardown per company (how they won their first market, organic engine, strengths, weaknesses, why it worked, your edge); landscape matrix + whitespace | competitor-profiling, reverse-engineer-marketing, competitors |
| Content & posts | Import Instagram/LinkedIn CSV, YouTube channels, YouTube category scans, community listening → exact medians by format / motivation / content type / language + what's working and what isn't | social, video, content-strategy, community-marketing |
| Brand & expansion | National positioning vs localisation; city scoring, categories, segments, 8-week city-launch playbook | product-marketing, marketing-psychology, marketing-plan, marketing-loops, launch |
| Experiments | Designs the live experiments (message, national vs local, acquisition engine + extras); log iterations; scale/iterate/kill review | ab-testing, marketing-ideas, marketing-loops |
| Growth OS | The head-of-growth toolkit (22 modules + a growth model). **Strategy & metrics:** growth model & unit economics (the app does the maths), North Star & metrics tree, growth loops, 90-day plan, messaging house & multilingual copy bank, offers & guarantee framing. **Organic acquisition:** 4-week content calendar with scripts, SEO & AI-search plan, creator programme, community programme, PR, partnerships, app stores, free tools, city launch kit. **Conversion:** website CRO audit, tracking & attribution plan. **Retention & referral:** WhatsApp/SMS/email lifecycle, referral programme. **Research & ops:** interview & survey kit, interview synthesis, weekly growth review, board-of-advisors critique of any output | 35+ skills |
| Skill lab | Run any of the 53 skills in the library against the company with your own brief; output feeds every other module | any |
| Reports | Insight doc, solution doc, organic growth playbook, 10–12 slide deck outline; one-click Markdown export | all of the above |
| Ask | Free-form questions answered from everything in the tool + web search | product-marketing |

**Evidence rules:** every material claim is labelled **[Observed]** (with a source), **[Inferred]** or **[Gap]**. Web sources Gemini used are listed under each output. Numbers in the content analysis are computed by the app, not by the model.

## Setup (5 minutes)

1. Get keys (all free):
   - Gemini: https://aistudio.google.com/apikey
   - Neon: Neon dashboard → your project → **Connect** → copy the connection string
   - YouTube (optional): Google Cloud console → enable *YouTube Data API v3* → Credentials → API key
2. In this folder, copy `.env.example` to `.env` and paste the keys.
3. Install and run:
   ```bash
   cd gtm-copilot
   npm install
   npm start
   ```
4. Open http://localhost:3300 → **Load Circle case** (pre-filled with facts from the Mesa problem statement) or create a new project.

Tables (`gtm_projects`, `gtm_records`) are created in Neon automatically on first start.

## Getting post data without paid APIs

- **Instagram:** Meta Business Suite → Insights → Content → Export (CSV), or copy numbers into a sheet. Columns: `date,platform,format,caption,views,likes,comments,shares,saves,clicks,url` (any order; `2.5k`, `1.2M`, `3L` are understood).
- **LinkedIn:** Page analytics → Content → Export.
- **Competitors' Instagram:** note the last 15–20 posts' views/likes/comments by hand into the same CSV with the competitor's name as the owner.
- **YouTube:** fetched automatically by `@handle`.
- **Reddit:** Reddit often blocks anonymous API access; the tool then runs search-grounded community listening (Reddit, Quora, forums, reviews) with links instead.

## Free-tier notes

The Gemini free tier allows only a few requests per minute. The app retries automatically after rate limits, and competitor teardowns run one at a time. A full first pass (profile, market, 8 teardowns, landscape, questions) takes roughly 10–15 minutes.
