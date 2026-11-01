import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { closeDB } from '../lib/db';
import { migrate } from '../scripts/migrate';
import { restoreBackup, exportCampaign } from '../lib/backup';
import { actorFor, visibleRecords } from '../lib/policy';
import { DEMO, DEMO_MASTER, DEMO_PLAYER1 } from '../scripts/seed';
async function main() {
  await migrate();
  const backup = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await restoreBackup(backup);
  const master = await actorFor(DEMO_MASTER, DEMO);
  const restored = await exportCampaign(master, { operator: true });
  for (const table of Object.keys(backup.data))
    assert.equal((restored.data[table] as any[]).length, backup.data[table].length, table);
  assert.equal(restored.files.length, backup.files.length);
  for (const source of backup.data.attachments) {
    const destination = (restored.data.attachments as any[]).find((f) => f.id === source.id);
    assert(destination, 'Se conserva el identificador del adjunto');
    assert.equal(
      restored.files.find((f) => f.key === destination.object_key)?.body,
      backup.files.find((f: any) => f.key === source.object_key)?.body,
    );
    assert.equal(destination.sha256, source.sha256);
  }

  assert((await visibleRecords(await actorFor(DEMO_PLAYER1, DEMO))).length > 0);
  console.log('RESTORE_OK');
}
main()
  .then(async () => {
    await closeDB();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
