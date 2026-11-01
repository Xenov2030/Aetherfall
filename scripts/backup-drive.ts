import { closeDB } from '../lib/db';
import { actorFor } from '../lib/policy';
import { backupToDrive } from '../lib/drive-backup';
async function main() {
  const [campaign, user] = process.argv.slice(2);
  if (!campaign || !user) throw new Error('Uso: npm run backup:drive -- UUID_CAMPAÑA UUID_MÁSTER');
  const r = await backupToDrive(await actorFor(user, campaign), true);
  console.log(
    `Respaldo administrativo guardado en tu Drive privado (${r.bytes} bytes). Referencia: ${r.reference}`,
  );
}
main()
  .then(async () => {
    await closeDB();
  })
  .catch(async () => {
    console.error(
      'No se pudo guardar el respaldo en Drive. Revisá la configuración; no se mostraron credenciales.',
    );
    await closeDB();
    process.exitCode = 1;
  });
