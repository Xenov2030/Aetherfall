import { closeDB } from '../lib/db';
import { readFile } from 'node:fs/promises';
import { migrate } from './migrate';
import { restoreBackup } from '../lib/backup';
async function main() {
  if (process.argv[3] !== '--confirmar-base-destino')
    throw new Error(
      'Uso: npm run restore -- /respaldo.json --confirmar-base-destino (base aislada sin esa campaña)',
    );
  await migrate();
  await restoreBackup(JSON.parse(await readFile(process.argv[2], 'utf8')));
  console.log('Campaña restaurada. Probá accesos y adjuntos antes de usarla.');
}
main()
  .then(async () => {
    await closeDB();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
