const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { OAuth2Client, CodeChallengeMethod } = require('google-auth-library');

async function main() {
  const output = 'Aetherfall-Drive-Servidor.env';
  if (fs.existsSync(output)) {
    console.log('Ya existe una autorizacion guardada. Se conservo sin reemplazarla.');
    return;
  }
  const c = JSON.parse(fs.readFileSync('client_secret_aetherfall.json', 'utf8')).installed;
  if (
    !c ||
    !c.client_id ||
    !c.client_secret ||
    c.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' ||
    c.token_uri !== 'https://oauth2.googleapis.com/token'
  )
    throw new Error();
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const state = crypto.randomBytes(32).toString('hex');
  const { codeVerifier, codeChallenge } = await new OAuth2Client().generateCodeVerifierAsync();
  let client,
    redirect,
    handled = false,
    succeeded = false;
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname === '/resultado' && handled) {
      res
        .writeHead(succeeded ? 200 : 400, headers)
        .end(
          succeeded
            ? 'Autorizacion guardada. Cerra esta ventana y volve a PowerShell.'
            : 'No se completo la autorizacion. Volve a PowerShell para reintentar.',
        );
      clearTimeout(timer);
      server.close();
      return;
    }
    if (u.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }
    const received = u.searchParams.get('state') || '';
    if (
      handled ||
      req.headers.host !== new URL(redirect).host ||
      !/^[a-f0-9]{64}$/.test(received) ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(received))
    ) {
      res.writeHead(400, headers).end('Solicitud no autorizada.');
      return;
    }
    handled = true;
    try {
      const code = u.searchParams.get('code');
      if (!code || u.searchParams.has('error')) throw new Error();
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect });
      if (!tokens.refresh_token || !tokens.access_token) throw new Error();
      const info = await client.getTokenInfo(tokens.access_token);
      if (!info.scopes.includes(scope) || info.scopes.some((s) => s !== scope)) throw new Error();
      const values = {
        GOOGLE_DRIVE_CLIENT_ID: c.client_id,
        GOOGLE_DRIVE_CLIENT_SECRET: c.client_secret,
        GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
      };
      fs.writeFileSync(
        output,
        Object.entries(values)
          .map(([k, v]) => k + '=' + JSON.stringify(v))
          .join('\n') + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      succeeded = true;
      console.log('AUTORIZACION GUARDADA. No abras ni compartas el contenido del archivo.');
    } catch {
      console.log('No se completo la autorizacion. No se mostraron credenciales.');
      process.exitCode = 1;
    }
    res.writeHead(303, { ...headers, Location: '/resultado' }).end();
  });
  const timer = setTimeout(() => {
    server.close();
    console.log('Vencio el plazo. Volve a ejecutar node autorizar.cjs.');
    process.exitCode = 1;
  }, 300000);
  timer.unref();
  server.on('error', () => {
    clearTimeout(timer);
    console.log('No se pudo abrir la conexion local.');
    process.exitCode = 1;
  });
  server.listen(0, '127.0.0.1', () => {
    redirect = 'http://127.0.0.1:' + server.address().port + '/oauth2callback';
    client = new OAuth2Client({
      clientId: c.client_id,
      clientSecret: c.client_secret,
      redirectUri: redirect,
    });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [scope],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    console.log('Elegi tu cuenta de Google y autoriza Aetherfall.');
    console.log('Si no se abre el navegador, abri esta direccion en esta computadora:');
    console.log(url);
    if (!process.argv.includes('--no-browser')) {
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
    }
  });
}
main().catch(() => {
  console.log('No se pudo iniciar. Revisa el JSON y que estes en la carpeta Aetherfall-Drive.');
  process.exitCode = 1;
});
