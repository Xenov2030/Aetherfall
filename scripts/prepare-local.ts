import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { once } from 'node:events';
import { localMode, closeDB } from '../lib/db';
import { migrate } from './migrate';
import { seedDemo } from './seed';
async function main() {
  if (!localMode() || !process.env.DATABASE_URL)
    throw new Error('Configurá el modo local primero.');
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/aetherfall_local')
    throw new Error('Este comando solo prepara la base local de demostración.');
  let child: ReturnType<typeof spawn> | undefined;
  const probe = async () => {
    const p = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      max: 1,
    });
    try {
      await p.query('SELECT 1');
    } finally {
      await p.end();
    }
  };
  try {
    try {
      await probe();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw e;
      child = spawn(
        process.execPath,
        ['--env-file=.env.local', '--import', 'tsx', 'scripts/local-postgres.ts'],
        { stdio: 'ignore' },
      );
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error('PostgreSQL local no pudo iniciar');
        try {
          await probe();
          ready = true;
          break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready) throw new Error('PostgreSQL local no respondió dentro del plazo');
    }
    await migrate();
    await seedDemo();
    console.log('Preparación local verificada. Solo se cargó la campaña ficticia.');
  } finally {
    await closeDB();
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
