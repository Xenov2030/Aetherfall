import { randomUUID } from 'node:crypto';
import { exportCampaign } from './backup';
import { backupsDrive, driveCredentialsPresent, filesDrive } from './google-drive';
import { storageProvider } from './storage';
import { master, type Actor } from './policy';
export function storageStatus() {
  return {
    provider: storageProvider(),
    driveConfigured:
      driveCredentialsPresent() &&
      !!process.env.GOOGLE_DRIVE_FILES_FOLDER_ID &&
      !!process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID,
    verified: false,
  };
}
export async function checkDrive(a: Actor) {
  master(a);
  await filesDrive().verifyFolder();
  await backupsDrive().verifyFolder();
  return { verified: true, scope: 'carpetas privadas accesibles' };
}
export async function backupToDrive(a: Actor, operator = false) {
  master(a);
  const backup = await exportCampaign(a, { operator });
  const bytes = Buffer.from(JSON.stringify(backup));
  const reference = await backupsDrive().upload(
    randomUUID(),
    bytes,
    'application/json',
    `Aetherfall-${a.campaignId}-${new Date().toISOString().replaceAll(':', '-')}.json`,
  );
  return {
    reference,
    bytes: bytes.length,
    scope: operator ? 'administrativo completo' : 'datos accesibles al máster',
  };
}
