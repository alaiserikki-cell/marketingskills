// Storage: Neon Postgres when DATABASE_URL is set, otherwise a local JSON file.
// Data model: projects + generic records (kind = artifact | question | post | experiment | fact | competitor).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'store.json');
let sql = null;

export function storageMode() {
  return sql ? 'neon' : 'local-json';
}

export async function initDb() {
  if (process.env.DATABASE_URL) {
    sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS gtm_projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS gtm_records (
      id SERIAL PRIMARY KEY,
      project_id INT REFERENCES gtm_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      key TEXT DEFAULT '',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS gtm_records_project_kind ON gtm_records(project_id, kind)`;
  } else {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (!fs.existsSync(DATA_FILE)) writeStore({ seq: 1, projects: [], records: [] });
  }
}

// ---------- local JSON helpers ----------
function readStore() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeStore(s) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
}
const now = () => new Date().toISOString();

// ---------- projects ----------
export async function listProjects() {
  if (sql) return sql`SELECT * FROM gtm_projects ORDER BY id DESC`;
  return readStore().projects.slice().reverse();
}

export async function getProject(id) {
  id = Number(id);
  if (sql) return (await sql`SELECT * FROM gtm_projects WHERE id = ${id}`)[0];
  return readStore().projects.find((p) => p.id === id);
}

export async function createProject({ name, website = '', description = '' }) {
  if (sql) return (await sql`INSERT INTO gtm_projects (name, website, description) VALUES (${name}, ${website}, ${description}) RETURNING *`)[0];
  const s = readStore();
  const p = { id: s.seq++, name, website, description, created_at: now() };
  s.projects.push(p);
  writeStore(s);
  return p;
}

export async function updateProject(id, { name, website, description }) {
  const cur = await getProject(id);
  if (!cur) return null;
  const next = { ...cur, name: name ?? cur.name, website: website ?? cur.website, description: description ?? cur.description };
  if (sql) return (await sql`UPDATE gtm_projects SET name=${next.name}, website=${next.website}, description=${next.description} WHERE id=${Number(id)} RETURNING *`)[0];
  const s = readStore();
  s.projects = s.projects.map((p) => (p.id === Number(id) ? next : p));
  writeStore(s);
  return next;
}

export async function deleteProject(id) {
  if (sql) return sql`DELETE FROM gtm_projects WHERE id=${Number(id)}`;
  const s = readStore();
  s.projects = s.projects.filter((p) => p.id !== Number(id));
  s.records = s.records.filter((r) => r.project_id !== Number(id));
  writeStore(s);
}

// ---------- records ----------
export async function listRecords(projectId, kind) {
  projectId = Number(projectId);
  if (sql) {
    return kind
      ? sql`SELECT * FROM gtm_records WHERE project_id=${projectId} AND kind=${kind} ORDER BY id`
      : sql`SELECT * FROM gtm_records WHERE project_id=${projectId} ORDER BY id`;
  }
  return readStore().records.filter((r) => r.project_id === projectId && (!kind || r.kind === kind));
}

export async function addRecord(projectId, kind, key, data) {
  if (sql) return (await sql`INSERT INTO gtm_records (project_id, kind, key, data) VALUES (${Number(projectId)}, ${kind}, ${key || ''}, ${JSON.stringify(data)}::jsonb) RETURNING *`)[0];
  const s = readStore();
  const r = { id: s.seq++, project_id: Number(projectId), kind, key: key || '', data, created_at: now(), updated_at: now() };
  s.records.push(r);
  writeStore(s);
  return r;
}

export async function getRecord(id) {
  if (sql) return (await sql`SELECT * FROM gtm_records WHERE id=${Number(id)}`)[0];
  return readStore().records.find((r) => r.id === Number(id));
}

export async function updateRecord(id, patch) {
  const cur = await getRecord(id);
  if (!cur) return null;
  const data = { ...cur.data, ...patch };
  if (sql) return (await sql`UPDATE gtm_records SET data=${JSON.stringify(data)}::jsonb, updated_at=now() WHERE id=${Number(id)} RETURNING *`)[0];
  const s = readStore();
  let out;
  s.records = s.records.map((r) => (r.id === Number(id) ? (out = { ...r, data, updated_at: now() }) : r));
  writeStore(s);
  return out;
}

export async function deleteRecord(id) {
  if (sql) return sql`DELETE FROM gtm_records WHERE id=${Number(id)}`;
  const s = readStore();
  s.records = s.records.filter((r) => r.id !== Number(id));
  writeStore(s);
}

export async function deleteRecordsByKind(projectId, kind, key) {
  if (sql) {
    return key == null
      ? sql`DELETE FROM gtm_records WHERE project_id=${Number(projectId)} AND kind=${kind}`
      : sql`DELETE FROM gtm_records WHERE project_id=${Number(projectId)} AND kind=${kind} AND key=${key}`;
  }
  const s = readStore();
  s.records = s.records.filter((r) => !(r.project_id === Number(projectId) && r.kind === kind && (key == null || r.key === key)));
  writeStore(s);
}

// One artifact per (project, key): replace on re-run, keep previous version in history.
export async function saveArtifact(projectId, key, data) {
  const prev = (await listRecords(projectId, 'artifact')).find((r) => r.key === key);
  if (prev) {
    const history = [...(prev.data.history || []), { at: prev.updated_at, text: prev.data.text }].slice(-3);
    return updateRecord(prev.id, { ...data, history, generated_at: now() });
  }
  return addRecord(projectId, 'artifact', key, { ...data, generated_at: now() });
}
