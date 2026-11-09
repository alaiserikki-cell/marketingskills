// Seeds the Circle case project with facts taken ONLY from the Mesa BSL problem statement PDF.
import * as db from './db.js';

const SRC = 'Mesa BSL Problem Statement: Circle (PDF, Cohort 4)';

const FACTS = [
  'Circle is building a trusted marketplace for Indians to buy and sell pre-owned products.',
  'Circle offers product verification, managed pickup and delivery, secure payments and the 3-Day Circle Guarantee.',
  'Founded in 2025 by Chirag Kataruka and Ankit Misra; started in Bengaluru.',
  'Crossed about ₹25 Cr in pre-owned sales within a year of launch.',
  '1 lakh+ listings across smartphones, gaming consoles, cameras, furniture, watches, handbags and sneakers.',
  'In October 2026 Circle raised a ₹25 Cr seed round led by Nexus Venture Partners, with Titan Capital, to expand across India.',
  "Ambition: 100 million Indians buying and selling safely on Circle; brand must grow organically rather than through paid spend alone.",
  'Five consumer motivations to study: value, trust, discovery, convenience, circular consumption.',
  'Required: at least three live organic experiments (brand message; national vs local content; organic acquisition engine) on Instagram, YouTube, Reddit, LinkedIn.',
  'Deliverables: brand strategy, 3+ live experiments, consumer insights, organic growth playbook, 10–12 slide recommendation deck.',
];

export async function seedCircle() {
  const existing = (await db.listProjects()).find((p) => p.name === 'Circle');
  if (existing) return existing;
  const p = await db.createProject({
    name: 'Circle',
    website: '',
    description:
      'Trusted marketplace to buy and sell pre-owned products in India (Bengaluru first). Problem: build a national consumer brand — what it stands for, where to localise, which organic channels and content drive discovery, trust and transactions.',
  });
  for (const text of FACTS) await db.addRecord(p.id, 'fact', '', { text, source: SRC });
  return p;
}
