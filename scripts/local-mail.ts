import { SMTPServer } from 'smtp-server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localMode } from '../lib/db';
if (!localMode()) throw new Error('El buzón de pruebas requiere modo local fuera de producción.');
const root = path.join(
  process.env.AETHERFALL_LOCAL_DIR || path.join(process.cwd(), '.local'),
  'mail',
);
mkdir(root, { recursive: true, mode: 0o700 }).catch(() => {
  process.exitCode = 1;
});
const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  authOptional: true,
  onData(stream, session, callback) {
    let text = '';
    stream.on('data', (chunk) => {
      text += chunk.toString();
    });
    stream.on('end', async () => {
      try {
        const to = session.envelope.rcptTo[0]?.address;
        if (!to?.endsWith('@example.test'))
          throw new Error('Solo se aceptan destinatarios ficticios @example.test');
        await writeFile(path.join(root, `${to}.eml`), text, { mode: 0o600 });
        callback();
      } catch (e) {
        callback(e as Error);
      }
    });
  },
});
server.listen(2525, '127.0.0.1', () =>
  console.log('Buzón local de pruebas activo en 2525; no envía correos externos.'),
);
