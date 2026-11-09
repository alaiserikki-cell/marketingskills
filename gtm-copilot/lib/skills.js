// Loads SKILL.md files from the marketingskills library (../skills) so every module
// runs with the same expert frameworks the repo gives coding agents.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Prefer the live library in the repo (../skills); fall back to the bundled copy used for deployments.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_SKILLS = path.resolve(HERE, '..', '..', 'skills');
const SKILLS_DIR = fs.existsSync(REPO_SKILLS) ? REPO_SKILLS : path.resolve(HERE, '..', 'skills-bundle');
const cache = new Map();

export function loadSkill(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(file)) return '';
  const raw = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  cache.set(name, raw);
  return raw;
}

export function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')));
}

const TOOL_NOTE = `
## Operating constraints for this app (override anything in the skills below)
- The only data tools available are: Google Search grounding, the company's own website text, YouTube Data API results, Reddit public search results, and data the user pasted or the CEO answered. Ignore instructions about paid tools, MCP servers, or files on disk.
- Never invent numbers, quotes, customers or dates. If a fact cannot be traced to a source you were given or found via search, write it as a GAP to verify.
- Label every material claim with one of: **[Observed]** (from a named source), **[Inferred]** (your reasoning from observed facts; say how confident), **[Gap]** (unknown; say how to find out).
- Do not ask the user questions in the output; the app has a separate clarifying-questions module. Proceed with what you have and list gaps.
- Write for an Indian consumer-internet context when the company is Indian. Use ₹ and Indian number formats (lakh, crore) where relevant.`;

export function systemFor(role, skillNames = []) {
  const skills = skillNames
    .map((n) => {
      const body = loadSkill(n);
      return body ? `\n\n<skill name="${n}">\n${body}\n</skill>` : '';
    })
    .join('');
  return `${role}\n${TOOL_NOTE}\n\nUse these expert frameworks from the marketingskills library where they apply:${skills}`;
}
