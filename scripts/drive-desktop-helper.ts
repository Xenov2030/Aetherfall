import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { DRIVE_SCOPE, createDriveFolders, filesDrive, backupsDrive } from '../lib/google-drive';

async function main() {
  if (process.argv.includes('--check')) {
    console.log(
      'Asistente listo: OAuth oficial, PKCE y permiso drive.file. Sin conexión ni lectura de credenciales.',
    );
    return;
  }
  const directory = path.resolve(process.argv[2] || process.cwd());
  const jsonFiles = (await readdir(directory)).filter((name) =>
    /^client_secret_.+\.json$/.test(name),
  );
  if (jsonFiles.length !== 1)
    throw new Error('Dejá en esta carpeta un único JSON client_secret_ descargado de Google.');
  const original = JSON.parse(await readFile(path.join(directory, jsonFiles[0]), 'utf8'));
  const c = original.installed;
  if (
    !c ||
    typeof c.client_id !== 'string' ||
    typeof c.client_secret !== 'string' ||
    !c.client_id ||
    !c.client_secret ||
    c.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' ||
    c.token_uri !== 'https://oauth2.googleapis.com/token'
  )
    throw new Error(
      'Se necesita el JSON original de un cliente OAuth de aplicación de escritorio.',
    );
  const output = path.join(directory, 'Aetherfall-Drive-Servidor.env');
  let previous: Record<string, string | undefined> = {};
  try {
    previous = parseEnv(await readFile(output, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('No se pudo leer la configuración privada existente.');
  }
  if (previous.GOOGLE_DRIVE_CLIENT_ID && previous.GOOGLE_DRIVE_CLIENT_ID !== c.client_id)
    throw new Error(
      'La configuración existente pertenece a otro cliente. Se conservó sin reemplazarla.',
    );
  const credentials: Record<string, string> = {
    GOOGLE_DRIVE_CLIENT_ID: c.client_id,
    GOOGLE_DRIVE_CLIENT_SECRET: c.client_secret,
  };
  const save = async (values: Record<string, string>) => {
    await writeFile(
      output,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    await chmod(output, 0o600);
  };
  const finish = async (token: string) => {
    const config: Record<string, string> = { ...credentials, GOOGLE_DRIVE_REFRESH_TOKEN: token };
    // Preserve an accepted authorization before attempting folder creation.
    await save({
      ...config,
      ...(previous.GOOGLE_DRIVE_FILES_FOLDER_ID
        ? { GOOGLE_DRIVE_FILES_FOLDER_ID: previous.GOOGLE_DRIVE_FILES_FOLDER_ID }
        : {}),
      ...(previous.GOOGLE_DRIVE_BACKUPS_FOLDER_ID
        ? { GOOGLE_DRIVE_BACKUPS_FOLDER_ID: previous.GOOGLE_DRIVE_BACKUPS_FOLDER_ID }
        : {}),
    });
    Object.assign(process.env, config);
    let files = previous.GOOGLE_DRIVE_FILES_FOLDER_ID,
      backups = previous.GOOGLE_DRIVE_BACKUPS_FOLDER_ID;
    if (files && backups) {
      Object.assign(process.env, {
        GOOGLE_DRIVE_FILES_FOLDER_ID: files,
        GOOGLE_DRIVE_BACKUPS_FOLDER_ID: backups,
      });
      await filesDrive().verifyFolder();
      await backupsDrive().verifyFolder();
    } else if (files || backups)
      throw new Error('La configuración de carpetas está incompleta; se conservó la autorización.');
    else ({ files, backups } = await createDriveFolders());
    await save({
      ...config,
      STORAGE_PROVIDER: 'drive',
      GOOGLE_DRIVE_FILES_FOLDER_ID: files,
      GOOGLE_DRIVE_BACKUPS_FOLDER_ID: backups,
    });
    console.log(
      'Autorización y carpetas privadas preparadas. Se guardó Aetherfall-Drive-Servidor.env.',
    );
    console.log(
      'El archivo contiene secretos: cargá sus variables en el panel privado del servidor/Vercel. No lo adjuntes al chat ni lo subas a Git.',
    );
    console.log(
      'Todavía hace falta configurar esas variables en el servidor de Aetherfall; este asistente no despliega la aplicación.',
    );
  };
  if (previous.GOOGLE_DRIVE_REFRESH_TOKEN) {
    console.log('Reutilizando la autorización local existente, sin mostrarla.');
    await finish(previous.GOOGLE_DRIVE_REFRESH_TOKEN);
    return;
  }
  const state = randomBytes(32).toString('hex');
  const seedClient = new OAuth2Client();
  const { codeVerifier, codeChallenge } = await seedClient.generateCodeVerifierAsync();
  let client: OAuth2Client,
    redirect = '',
    handled = false;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url || '/', redirect);
    if (u.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }
    const received = u.searchParams.get('state') || '';
    if (
      handled ||
      req.headers.host !== new URL(redirect).host ||
      !/^[a-f0-9]{64}$/.test(received) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(received))
    ) {
      res.writeHead(400).end('Solicitud no autorizada.');
      return;
    }
    handled = true;
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    };
    try {
      const code = u.searchParams.get('code');
      if (!code || u.searchParams.has('error')) throw new Error('No se concedió el acceso.');
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect });
      if (!tokens.refresh_token || !tokens.access_token)
        throw new Error('Google no entregó una autorización renovable.');
      const info = await client.getTokenInfo(tokens.access_token);
      if (!info.scopes.includes(DRIVE_SCOPE) || info.scopes.some((scope) => scope !== DRIVE_SCOPE))
        throw new Error('El cliente debe tener únicamente el permiso drive.file.');
      await finish(tokens.refresh_token);
      res
        .writeHead(200, headers)
        .end(
          'Listo: autorización y carpetas privadas preparadas. Cerrá esta ventana y volvé al asistente. Las credenciales quedaron solo en tu computadora.',
        );
    } catch {
      console.error(
        'No se pudo terminar. Si Google ya aceptó el acceso, la autorización local puede haberse conservado; volvé a ejecutar el asistente. No se imprimieron tokens ni respuestas privadas.',
      );
      res
        .writeHead(400, headers)
        .end('No se pudo completar la preparación. Volvé al asistente para reintentarlo.');
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      server.close();
    }
  });
  const timer = setTimeout(() => {
    server.close();
    console.error('Venció el plazo de cinco minutos. Podés volver a ejecutar el asistente.');
    process.exitCode = 1;
  }, 300000);
  timer.unref();
  server.on('error', () => {
    clearTimeout(timer);
    console.error(
      'No se pudo abrir el receptor local de Google. Cerrá otra instancia del asistente y reintentá.',
    );
    process.exitCode = 1;
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    redirect = `http://127.0.0.1:${address.port}/oauth2callback`;
    client = new OAuth2Client({
      clientId: c.client_id,
      clientSecret: c.client_secret,
      redirectUri: redirect,
    });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    console.log(
      'Se abrirá Google. Elegí la cuenta cuyo Drive querés usar y aceptá el permiso de Aetherfall.',
    );
    console.log(
      'Si el navegador no se abre, copiá esta dirección en el navegador de esta computadora:',
    );
    console.log(url);
    if (process.argv.includes('--no-browser')) return;
    const command =
      process.platform === 'win32'
        ? 'rundll32.exe'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  });
}
main().catch((e: unknown) => {
  // Only our controlled setup errors may be printed; upstream responses never reach this logger.
  const message =
    e instanceof Error &&
    [
      'Dejá en esta carpeta',
      'Se necesita el JSON',
      'La configuración existente',
      'No se pudo leer',
    ].some((prefix) => e.message.startsWith(prefix))
      ? e.message
      : 'No se pudo completar la preparación. Revisá el archivo de cliente, el permiso de Drive y la conexión a Internet. No se mostraron secretos.';
  console.error(message);
  process.exitCode = 1;
});
