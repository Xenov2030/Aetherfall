import { closeDB } from '../lib/db';
import { writeFile } from 'node:fs/promises';
import { exportCampaign } from '../lib/backup';
import { actorFor } from '../lib/policy';
async function main() {
  const [campaign, user, file] = process.argv.slice(2);
  if (!campaign || !user || !file)
    throw new Error('Uso: npm run backup -- CAMPAÑA_UUID MÁSTER_UUID /ruta/privada/respaldo.json');
  const backup = await exportCampaign(await actorFor(user, campaign), { operator: true });
  await writeFile(file, JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
  console.log('Respaldo completo guardado. Contiene información privada; almacenalo cifrado.');
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
