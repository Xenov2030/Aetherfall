import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const fixture = {
  installed: {
    client_id: 'desktop-ficticio.apps.googleusercontent.com',
    client_secret: 'SECRETO_SINTETICO_NO_MOSTRAR',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    redirect_uris: ['http://localhost'],
  },
};
function start(dir: string) {
  const child = spawn(
    process.execPath,
    [
      ...(process.env.AETHERFALL_HELPER_ENTRY?.endsWith('.cjs') ? [] : ['--import', 'tsx']),
      process.env.AETHERFALL_HELPER_ENTRY || path.resolve('scripts/drive-desktop-helper.ts'),
      dir,
      '--no-browser',
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { child, done, output: () => output };
}
test('Asistente de Drive: valida estado/PKCE y respeta una denegación sin llamar a Google ni guardar tokens', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aetherfall-oauth-helper-'));
  await writeFile(path.join(dir, 'client_secret_test.json'), JSON.stringify(fixture), {
    mode: 0o600,
  });
  const run = start(dir);
  try {
    let url: URL | undefined;
    for (let i = 0; i < 100; i++) {
      const match = run
        .output()
        .match(/https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth[^\s]+/);
      if (match) {
        url = new URL(match[0]);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(url, 'El asistente ofrece consentimiento de Google');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('access_type'), 'offline');
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    assert.equal(redirect.hostname, '127.0.0.1');
    const invalid = new URL(redirect);
    invalid.searchParams.set('state', 'no-autorizado');
    invalid.searchParams.set('error', 'access_denied');
    assert.equal((await fetch(invalid)).status, 400);
    const denied = new URL(redirect);
    denied.searchParams.set('state', url.searchParams.get('state')!);
    denied.searchParams.set('error', 'access_denied');
    assert.equal((await fetch(denied)).status, 400);
    assert.equal(await run.done, 1);
    assert(!run.output().includes(fixture.installed.client_secret));
    await assert.rejects(access(path.join(dir, 'Aetherfall-Drive-Servidor.env')));
  } finally {
    if (run.child.exitCode === null) run.child.kill('SIGTERM');
  }
});
test('Asistente de Drive: conserva una configuración privada de otro cliente sin sobrescribirla', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aetherfall-oauth-existing-'));
  await writeFile(path.join(dir, 'client_secret_test.json'), JSON.stringify(fixture));
  const file = path.join(dir, 'Aetherfall-Drive-Servidor.env'),
    original =
      'GOOGLE_DRIVE_CLIENT_ID=otro-cliente\nGOOGLE_DRIVE_REFRESH_TOKEN=TOKEN_SINTETICO_PRIVADO\n';
  await writeFile(file, original, { mode: 0o600 });
  const run = start(dir);
  assert.equal(await run.done, 1);
  assert.equal(await readFile(file, 'utf8'), original);
  assert(!run.output().includes('TOKEN_SINTETICO_PRIVADO'));
  assert(!run.output().includes(fixture.installed.client_secret));
});
