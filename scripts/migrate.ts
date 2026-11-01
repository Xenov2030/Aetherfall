import { closeDB } from '../lib/db';
import { db, one } from '../lib/db';
import { readdir, readFile } from 'node:fs/promises';
export async function migrate() {
  const conn = await db();
  await conn.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    if (await one('SELECT name FROM schema_migrations WHERE name=$1', [name])) continue;
    const sql = await readFile(`migrations/${name}`, 'utf8');
    // Split only repository-owned migration statements; no user input is executed as SQL.
    await conn.transaction(async (tx) => {
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    });
    console.log(`Migración aplicada: ${name}`);
  }
}
if (process.argv[1]?.endsWith('migrate.ts'))
  migrate()
    .then(async () => {
      await closeDB();
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
