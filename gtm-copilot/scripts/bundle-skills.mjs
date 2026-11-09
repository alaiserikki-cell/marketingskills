// Copies ../skills/*/SKILL.md into ./skills-bundle so the app can be deployed on its own (e.g. Vercel).
// Run after pulling new skills from upstream: npm run bundle-skills
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'skills');
const dest = path.resolve(here, '..', 'skills-bundle');
fs.rmSync(dest, { recursive: true, force: true });
let n = 0;
for (const name of fs.readdirSync(src)) {
  const f = path.join(src, name, 'SKILL.md');
  if (!fs.existsSync(f)) continue;
  fs.mkdirSync(path.join(dest, name), { recursive: true });
  fs.copyFileSync(f, path.join(dest, name, 'SKILL.md'));
  n++;
}
console.log(`Bundled ${n} skills into skills-bundle/`);
