import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
async function main() {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('Iniciá npm run db:local antes de las pruebas nativas.');
  const url = new URL(configured);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/aetherfall_local')
    throw new Error('Las pruebas nativas solo crean una base aislada en el PostgreSQL local.');
  const pool = new Pool({ connectionString: configured });
  const name = 'aetherfall_test_' + randomUUID().replaceAll('-', '');
  await pool.query(`CREATE DATABASE ${name}`);
  const testUrl = new URL(configured);
  testUrl.pathname = '/' + name;
  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/core.test.ts'],
        {
          stdio: 'inherit',
          env: { ...process.env, AETHERFALL_TEST_DATABASE_URL: testUrl.toString() },
        },
      );
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await pool.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await pool.end();
  }
  process.exitCode = exitCode;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
