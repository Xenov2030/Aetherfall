import { closeDB } from '../lib/db';
import { randomUUID } from 'node:crypto';
import { db, one } from '../lib/db';
import { migrate } from './migrate';
import { createRecord, createFolder, addFragment, reveal } from '../lib/service';
import type { Actor } from '../lib/policy';
export const DEMO = 'd0000000-0000-4000-8000-000000000001';
export const DEMO_MASTER = 'd0000000-0000-4000-8000-000000000002';
export const DEMO_PLAYER1 = 'd0000000-0000-4000-8000-000000000003';
export const DEMO_PLAYER2 = 'd0000000-0000-4000-8000-000000000004';
export async function seedDemo() {
  await migrate();
  const conn = await db();
  if (await one('SELECT id FROM campaigns WHERE id=$1', [DEMO])) return;
  await conn.query('INSERT INTO campaigns(id,name,group_name,demo) VALUES($1,$2,$3,true)', [
    DEMO,
    'El archivo de las cenizas',
    'Campaña de demostración',
  ]);
  for (const [id, email, name, role] of [
    [DEMO_MASTER, 'master@example.test', 'Máster de prueba', 'master'],
    [DEMO_PLAYER1, 'lira@example.test', 'Lira · tester', 'player'],
    [DEMO_PLAYER2, 'bruno@example.test', 'Bruno · tester', 'player'],
  ]) {
    await conn.query('INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,$3,now())', [
      id,
      email,
      name,
    ]);
    await conn.query('INSERT INTO members(campaign_id,user_id,role) VALUES($1,$2,$3)', [
      DEMO,
      id,
      role,
    ]);
  }
  const a: Actor = { userId: DEMO_MASTER, campaignId: DEMO, role: 'master' };
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
  const s1 = await createFolder(a, { name: 'Sesión 01', parent_id: folders.Sesiones });
  for (const name of ['Preparación', 'Mapas', 'Imágenes', 'Notas', 'Material utilizado'])
    await createFolder(a, { name, parent_id: s1.id });
  const lira = await createRecord(a, {
    kind: 'character',
    title: 'Lira del Umbral',
    status: 'vigente',
    folder_id: folders.Personajes,
    data: {
      identity: 'Personaje ficticio de prueba.',
      sheet: {},
      editable: ['playerNotes', 'resources'],
      playerNotes: '',
      resources: {},
    },
  });
  const bruno = await createRecord(a, {
    kind: 'character',
    title: 'Bruno de la Bruma',
    status: 'vigente',
    folder_id: folders.Personajes,
    data: {
      identity: 'Personaje ficticio de prueba.',
      sheet: {},
      editable: ['playerNotes'],
      playerNotes: '',
    },
  });
  await conn.query('UPDATE records SET owner_id=$2 WHERE id=$1', [lira.id, DEMO_PLAYER1]);
  await conn.query('UPDATE records SET owner_id=$2 WHERE id=$1', [bruno.id, DEMO_PLAYER2]);
  await createRecord(a, {
    kind: 'session',
    title: 'Bajo un cielo de ceniza',
    status: 'planeado',
    folder_id: s1.id,
    body: 'Preparación privada: escuchar las intenciones de cada personaje antes de abrir la escena.',
    data: {
      number: 2,
      date: '',
      worldTime: '',
      introduction: 'La campana del puerto vuelve a sonar. Sobre la mesa, una carta sin abrir.',
      summary: '',
      closing: '',
      pending: 'Revisar las promesas de la última reunión.',
      resume: 'Una conversación junto al muelle.',
      participants: [],
    },
  });
  const session = await createRecord(a, {
    kind: 'session',
    title: 'La puerta entreabierta',
    status: 'realizada',
    folder_id: folders.Sesiones,
    body: 'Crónica privada de demostración. La identidad de la figura sigue sin revelarse.',
    data: {
      number: 1,
      date: '',
      introduction: '',
      summary: '',
      closing: '',
      resume: 'La puerta de la posada quedó entreabierta.',
    },
  });
  const recap = await addFragment(a, session.id, {
    title: 'Lo que vimos en el muelle',
    body: 'Una barca vacía llegó con la marea. En su interior había un farol todavía encendido.',
  });
  await reveal(a, recap.id, { characters: [lira.id], source: 'presenció' });
  const place = await createRecord(a, {
    kind: 'lore',
    title: 'El puerto de Niebra',
    status: 'vigente',
    folder_id: folders.Mundo,
    body: 'Información privada de demostración: hay un pasadizo bajo el faro.',
  });
  const known = await addFragment(a, place.id, {
    title: 'El viejo muelle',
    body: 'Los tablones crujen con la marea. Una campana oxidada cuelga al final del espigón.',
  });
  await reveal(a, known.id, { characters: [lira.id, bruno.id], source: 'recibió' });
  await createRecord(a, {
    kind: 'npc',
    title: 'La farera',
    status: 'rumor',
    folder_id: folders.NPC,
    body: 'Entrada ficticia pendiente de desarrollar. No publicada.',
  });
  await createRecord(a, {
    kind: 'idea',
    title: 'Una carta que nunca llegó',
    status: 'planeado',
    folder_id: folders['Ideas pendientes'],
    body: 'Idea futura; no cambia el canon vigente.',
  });
  await createRecord(a, {
    kind: 'pending',
    title: 'Volver a hablar con la farera',
    status: 'pendiente',
    body: 'Sin vencimiento. El máster decide si hay consecuencias.',
    data: { knownUrgency: 'No indicada', realConsequences: 'Por decidir', worldDeadline: '' },
  });
  await createRecord(a, {
    kind: 'relic',
    title: 'El farol apagado',
    status: 'planeado',
    folder_id: folders.Reliquias,
    body: 'Idea de demostración. No asignada ni entregada.',
    data: { current: 'Sin definir', planned: 'Sin definir' },
  });
}
if (process.argv[1]?.endsWith('seed.ts'))
  seedDemo()
    .then(async () => {
      console.log('Campaña ficticia preparada. Sin cuentas reales ni correos enviados.');
      await closeDB();
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
