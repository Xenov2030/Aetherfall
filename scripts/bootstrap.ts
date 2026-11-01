import { closeDB } from '../lib/db';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, one } from '../lib/db';
import { migrate } from './migrate';
import { createFolder, createRecord } from '../lib/service';
const email = z.email().parse(process.argv[2]).toLowerCase();
async function main() {
  await migrate();
  const conn = await db();
  if (await one('SELECT id FROM campaigns WHERE name=$1 AND demo=false', ['Aetherfall']))
    throw new Error('La campaña ya existe. Usá las invitaciones desde la aplicación.');
  const campaignId = randomUUID(),
    userId = (await one('SELECT id FROM users WHERE email=$1', [email]))?.id ?? randomUUID();
  await conn.transaction(async (tx) => {
    await tx.query('INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO NOTHING', [
      userId,
      email,
    ]);
    await tx.query('INSERT INTO campaigns(id,name,group_name) VALUES($1,$2,$3)', [
      campaignId,
      'Aetherfall',
      'La Banda Viajera',
    ]);
    await tx.query("INSERT INTO members(campaign_id,user_id,role) VALUES($1,$2,'master')", [
      campaignId,
      userId,
    ]);
  });
  const a = { userId, campaignId, role: 'master' as const };
  const folders: Record<string, string> = {};
  for (const name of [
    'Sesiones',
    'Personajes',
    'Mundo',
    'NPC',
    'Villanos',
    'Reliquias',
    'Mecánicas',
    'Ideas pendientes',
  ])
    folders[name] = (await createFolder(a, { name })).id;
  for (const [title, player] of [
    ['Aldrich Ironhart', 'Javier Agustín Reka'],
    ['Corvin Dorian', 'Facundo'],
    ['Toren Hearthlight', 'Lucho'],
    ['Arlen Greyfang', 'Rama'],
    ['Timo Vhalder', 'Lucas'],
  ])
    await createRecord(a, {
      kind: 'character',
      title,
      status: 'borrador',
      folder_id: folders.Personajes,
      data: { playerLabel: player, sheet: {}, editable: [] },
    });
  for (const title of ['Hollow Creek', 'Ashford', 'Taberna El Ciervo y la Lanza'])
    await createRecord(a, { kind: 'lore', title, status: 'borrador', folder_id: folders.Mundo });
  await createRecord(a, {
    kind: 'npc',
    title: 'Edrik Vhal',
    status: 'borrador',
    folder_id: folders.NPC,
  });
  console.log(
    'Campaña real creada. Todas las entradas están privadas y sin propietarios. Iniciá sesión con el correo indicado.',
  );
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
