import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { DRIVE_SCOPE } from '../lib/google-drive';

async function main() {
  if (process.env.VERCEL)
    throw new Error(
      'La autorización inicial se ejecuta en tu computadora, no en una función de Vercel.',
    );
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID,
    secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !secret)
    throw new Error(
      'Configurá el ID y secreto de un cliente OAuth de escritorio en .env.local. No los pegues en el chat.',
    );
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN && !process.argv.includes('--reconectar'))
    throw new Error(
      'Ya hay una autorización configurada. Para reemplazarla explícitamente, usá --reconectar.',
    );
  const redirect = 'http://127.0.0.1:53682/oauth2callback';
  const client = new OAuth2Client({ clientId, clientSecret: secret, redirectUri: redirect });
  const state = randomBytes(32).toString('hex');
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: [DRIVE_SCOPE],
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  let handled = false;
  const server = createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', redirect);
    if (parsed.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }
    const received = parsed.searchParams.get('state') ?? '';
    if (
      handled ||
      req.headers.host !== '127.0.0.1:53682' ||
      received.length !== state.length ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(state))
    ) {
      res.writeHead(400).end('Solicitud no autorizada.');
      return;
    }
    handled = true;
    try {
      const code = parsed.searchParams.get('code');
      if (!code || parsed.searchParams.has('error'))
        throw new Error('La autorización no fue concedida');
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect });
      if (!tokens.access_token) throw new Error('Google no devolvió acceso verificable');
      const info = await client.getTokenInfo(tokens.access_token);
      if (!info.scopes.includes(DRIVE_SCOPE) || info.scopes.some((scope) => scope !== DRIVE_SCOPE))
        throw new Error('Usá un cliente OAuth dedicado exclusivamente al alcance drive.file');
      if (!tokens.refresh_token)
        throw new Error(
          'Google no devolvió autorización renovable. Reintentá con consentimiento explícito.',
        );
      // Persist only on the administrator's computer, never print tokens or return them to the browser.
      let existing = '';
      try {
        existing = await readFile('.env.local', 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const values: Record<string, string> = {
        GOOGLE_DRIVE_CLIENT_ID: clientId,
        GOOGLE_DRIVE_CLIENT_SECRET: secret,
        GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
        STORAGE_PROVIDER: 'drive',
      };
      for (const [name, value] of Object.entries(values)) {
        existing = existing
          .split('\n')
          .filter((line) => !new RegExp(`^${name}=`).test(line))
          .join('\n');
        existing = existing.trimEnd() + `\n${name}=${JSON.stringify(value)}\n`;
      }
      await writeFile('.env.local', existing, { mode: 0o600 });
      await chmod('.env.local', 0o600);
      res
        .writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        })
        .end(
          'Autorización guardada en tu computadora. Podés cerrar esta ventana y continuar con la preparación de carpetas.',
        );
      console.log(
        'Autorización guardada en .env.local sin mostrar credenciales. Ejecutá npm run drive:setup.',
      );
    } catch {
      res
        .writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        .end(
          'No se pudo completar la autorización. Revisá la configuración y volvé a iniciar el comando.',
        );
      console.error(
        'No se pudo guardar la autorización de Google. No se registraron tokens ni respuestas privadas.',
      );
      process.exitCode = 1;
    } finally {
      server.close();
      clearTimeout(timer);
    }
  });
  const timer = setTimeout(
    () => {
      console.error('Venció el plazo para autorizar Google Drive. Volvé a ejecutar el comando.');
      server.close();
      process.exitCode = 1;
    },
    5 * 60 * 1000,
  );
  timer.unref();
  server.on('error', () => {
    clearTimeout(timer);
    console.error('No se pudo abrir el receptor local de autorización en 127.0.0.1:53682.');
    process.exitCode = 1;
  });
  server.listen(53682, '127.0.0.1', () => {
    console.log(
      'Ejecutá este comando en tu propia computadora y abrí esta dirección en el navegador de esa computadora:',
    );
    console.log(url);
  });
}
main().catch(() => {
  console.error(
    'No se pudo iniciar la autorización. Revisá las variables del cliente OAuth de escritorio y la guía docs/google-drive.md. No se mostraron credenciales.',
  );
  process.exitCode = 1;
});
