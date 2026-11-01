import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, appendFile } from 'node:fs/promises';
if (process.env.VERCEL || process.env.NODE_ENV === 'production')
  throw new Error('Este comando es solo para desarrollo.');
async function main() {
  await mkdir('.local', { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      '.env.local',
      `AETHERFALL_LOCAL=1\nNEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_SECRET=${randomBytes(48).toString('base64url')}\nSMTP_URL=smtp://127.0.0.1:2525\nEMAIL_FROM=Aetherfall <acceso@example.test>\n`,
      { flag: 'wx', mode: 0o600 },
    );
    console.log('Configuración local creada. Secreto aleatorio guardado fuera de Git.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    console.log('Se conserva .env.local existente.');
  }
  if (!process.env.DATABASE_URL) {
    const password = randomBytes(32).toString('hex');
    await appendFile(
      '.env.local',
      `DATABASE_URL=postgresql://aetherfall:${password}@127.0.0.1:55432/aetherfall_local\n`,
    );
    console.log('Conexión PostgreSQL local configurada con una clave aleatoria.');
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
