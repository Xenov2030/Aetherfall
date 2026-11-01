import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { localMode } from '../lib/db';
async function main() {
  if (!localMode() || !process.env.DATABASE_URL)
    throw new Error('Requiere la configuración local de desarrollo.');
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/aetherfall_local')
    throw new Error('Este comando solo inicia la base local aetherfall_local en loopback.');
  const root = path.resolve('.local/native-postgres'),
    socket = path.resolve('.local/socket');
  await mkdir(socket, { recursive: true, mode: 0o700 });
  const cluster = new EmbeddedPostgres({
    databaseDir: root,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port),
    persistent: true,
    authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1', '-k', socket],
    onLog: () => {},
    onError: () => {},
  });
  let initialized = false;
  try {
    await access(path.join(root, 'PG_VERSION'));
    initialized = true;
  } catch {}
  if (!initialized) await cluster.initialise();
  await cluster.start();
  const client = cluster.getPgClient();
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname='aetherfall_local'");
  await client.end();
  if (!exists.rows.length) await cluster.createDatabase('aetherfall_local');
  console.log('PostgreSQL local disponible en loopback:55432. Datos persistentes fuera de Git.');
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await cluster.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => {
  console.error('PostgreSQL local:', e instanceof Error ? e.message : 'No se pudo iniciar');
  process.exitCode = 1;
});
