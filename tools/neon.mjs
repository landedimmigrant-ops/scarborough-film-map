/* ══════════════════════════════════════════════════════════════
   tools/neon.mjs — the Node-side Neon access layer for this repo's
   scripts (db-exec.mjs, import-json.mjs).
   ──────────────────────────────────────────────────────────────
   Deliberately dependency-free: it speaks Neon's SQL-over-HTTP
   protocol with plain fetch, the same wire format the Pages Function
   uses (functions/api/[[route]].js). Two copies of ~20 lines beats
   adding npm + a bundler to a project whose whole premise is "no
   build step" — but keep them in sync if the protocol shifts.

   Credentials come from .neon (gitignored) or $NEON_DATABASE_URL.
   Never commit a connection string.
══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function connectionString() {
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.neon', import.meta.url)), 'utf8');
    const cs = JSON.parse(raw).connectionString;
    if (cs) return cs;
  } catch { /* fall through to the explicit error below */ }
  throw new Error(
    'No Neon connection string. Set NEON_DATABASE_URL, or create .neon with\n' +
    '  { "connectionString": "postgresql://…" }\n' +
    '(get it from: npx neonctl connection-string --project-id <id>)');
}

/* Neon's HTTP endpoint lives on the compute host, not the pooler host. */
export function sqlEndpoint(cs = connectionString()) {
  const host = new URL(cs).hostname.replace('-pooler', '');
  return `https://${host}/sql`;
}

/* One statement per call, $1-style params. Returns rows as objects. */
export async function query(text, params = [], cs = connectionString()) {
  const res = await fetch(sqlEndpoint(cs), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': cs },
    body: JSON.stringify({ query: text, params }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`neon ${res.status}: ${body.slice(0, 400)}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`neon sql: ${json.error}`);
  return json.rows || [];
}

/* Split a .sql file into statements. Naive on purpose — it only needs to
   handle this repo's DDL (no $$-quoted function bodies); it strips line
   comments and refuses to guess at anything cleverer. */
export function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
