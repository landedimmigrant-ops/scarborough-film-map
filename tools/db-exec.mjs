#!/usr/bin/env node
/* Run SQL against this project's Neon database.
     node tools/db-exec.mjs --file schema.sql
     node tools/db-exec.mjs "select count(*) from locations"
   Credentials: .neon (gitignored) or $NEON_DATABASE_URL. */
import { readFileSync } from 'node:fs';
import { query, splitStatements } from './neon.mjs';

const argv = process.argv.slice(2);
const fileIdx = argv.indexOf('--file');
let statements;

if (fileIdx !== -1) {
  const path = argv[fileIdx + 1];
  if (!path) { console.error('--file needs a path'); process.exit(1); }
  statements = splitStatements(readFileSync(path, 'utf8'));
} else if (argv.length) {
  statements = [argv.join(' ')];
} else {
  console.error('usage: db-exec.mjs --file <path.sql> | "<sql>"');
  process.exit(1);
}

for (const s of statements) {
  const label = s.replace(/\s+/g, ' ').slice(0, 72);
  try {
    const rows = await query(s);
    console.log(`✓ ${label}${rows.length ? `\n${JSON.stringify(rows, null, 2)}` : ''}`);
  } catch (e) {
    console.error(`✗ ${label}\n  ${e.message}`);
    process.exit(1);
  }
}
