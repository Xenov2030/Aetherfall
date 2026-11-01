import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createDriveFolders, filesDrive, backupsDrive } from '../lib/google-drive';
async function main() {
  const files = process.env.GOOGLE_DRIVE_FILES_FOLDER_ID,
    backups = process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID;
  if (files && backups) {
    await filesDrive().verifyFolder();
    await backupsDrive().verifyFolder();
    console.log('Las carpetas privadas existentes de Drive están disponibles.');
    return;
  }
  if (files || backups)
    throw new Error(
      'Hay una configuración parcial de carpetas. Revisala antes de crear otra estructura.',
    );
  const result = await createDriveFolders();
  let env = '';
  try {
    env = await readFile('.env.local', 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  env =
    env.trimEnd() +
    `\nSTORAGE_PROVIDER=drive\nGOOGLE_DRIVE_FILES_FOLDER_ID=${result.files}\nGOOGLE_DRIVE_BACKUPS_FOLDER_ID=${result.backups}\n`;
  await writeFile('.env.local', env, { mode: 0o600 });
  await chmod('.env.local', 0o600);
  console.log(
    'Creadas Aetherfall/Archivos y Aetherfall/Respaldos en tu Drive privado. Configuración guardada en .env.local. No se compartieron carpetas ni archivos.',
  );
}
main().catch(() => {
  console.error(
    'No se pudieron preparar las carpetas. Revisá la autorización y la guía de Drive. No se mostraron credenciales.',
  );
  process.exitCode = 1;
});
