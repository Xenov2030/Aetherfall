import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { db, one, closeDB } from '../lib/db';
import { seedDemo, DEMO, DEMO_MASTER, DEMO_PLAYER1, DEMO_PLAYER2 } from '../scripts/seed';
import { actorFor, visibleRecords, readRecord, canReadAttachment, type Actor } from '../lib/policy';
import {
  createRecord,
  addFragment,
  reveal,
  updateRecord,
  createFolder,
  trashRecord,
  propose,
  setMember,
  rollFormula,
  restoreRevision,
  updateFolder,
  assignCharacter,
  invite,
} from '../lib/service';
import { exportCampaign } from '../lib/backup';
import { validateFile, putObject, readObject } from '../lib/storage';
import {
  createIntegration,
  integrationFromHeader,
  checkIntegration,
  revokeIntegration,
} from '../lib/integrations';
import * as community from '../lib/community';
import * as commerce from '../lib/commerce';
import { loginAllowed, acceptInvitations, rateLimit } from '../lib/auth';
after(async () => {
  await closeDB();
});
let master: Actor, p1: Actor, p2: Actor, char1: string, char2: string;
before(async () => {
  process.env.AETHERFALL_LOCAL = '1';
  process.env.STORAGE_PROVIDER = 'local';
  assert(
    process.env.NODE_ENV !== 'production' && !process.env.VERCEL,
    'Las pruebas requieren un entorno de desarrollo aislado.',
  );
  process.env.DATABASE_URL = process.env.AETHERFALL_TEST_DATABASE_URL || '';
  process.env.AETHERFALL_LOCAL_DIR = await mkdtemp(path.join(tmpdir(), 'aetherfall-test-'));
  await seedDemo();
  master = await actorFor(DEMO_MASTER, DEMO);
  p1 = await actorFor(DEMO_PLAYER1, DEMO);
  p2 = await actorFor(DEMO_PLAYER2, DEMO);
  char1 = (await visibleRecords(p1)).find((r) => r.kind === 'character')!.id;
  char2 = (await visibleRecords(p2)).find((r) => r.kind === 'character')!.id;
});
test('Un jugador no puede obtener un registro privado ni una ficha ajena por ID', async () => {
  const secret = await createRecord(master, {
    kind: 'npc',
    title: 'NOMBRE_SECRETO',
    body: 'SECRETO_ABSOLUTO',
    data: { secret: 'OCULTO' },
  });
  await assert.rejects(readRecord(p1, secret.id));
  await assert.rejects(readRecord(p1, char2));
  const data = JSON.stringify(await visibleRecords(p1, { search: 'SECRETO' }));
  assert.equal(data, '[]');
  await assert.rejects(createRecord(p1, { kind: 'lore', title: 'Intrusión' }));
});
test('Revelaciones por personaje sin filtrar títulos, campos, relaciones ni carpetas privados', async () => {
  const r = await createRecord(master, {
    kind: 'lore',
    title: 'IDENTIDAD_REAL_PRIVADA',
    body: 'ESTADÍSTICAS_SECRETAS',
    data: { secret: 'INVISIBLE' },
  });
  const f = await addFragment(master, r.id, {
    title: 'Una sombra',
    body: 'Un silbido detrás de la puerta.',
  });
  await reveal(master, f.id, { characters: [char1], source: 'presenció' });
  const visible = await readRecord(p1, f.id);
  assert.equal(visible.title, 'Una sombra');
  const serialized = JSON.stringify(visible);
  for (const secret of [
    'IDENTIDAD_REAL_PRIVADA',
    'ESTADÍSTICAS_SECRETAS',
    'INVISIBLE',
    'folder_id',
  ])
    assert(!serialized.includes(secret));
  await assert.rejects(readRecord(p2, f.id));
  assert.equal((await visibleRecords(p2, { search: 'Una sombra' })).length, 0);
  await reveal(master, f.id, { characters: [char1], source: 'recibió', revoke: true });
  await assert.rejects(readRecord(p1, f.id));
});
test('Mover carpetas, vincular a sesiones y registrar asistencia no concede acceso', async () => {
  const folder = await createFolder(master, { name: 'Carpeta privada' });
  const r = await createRecord(master, { kind: 'lore', title: 'Solo máster' });
  await updateRecord(master, r.id, { version: r.version, folder_id: folder.id });
  await createRecord(master, {
    kind: 'attendance',
    title: 'Presencia',
    data: { characterId: char2, participation: 'presente' },
  });
  await assert.rejects(readRecord(p2, r.id));
  await assert.rejects(updateFolder(master, folder.id, { name: 'Ciclo', parent_id: folder.id }));
});
test('Movimientos concurrentes de carpetas no crean ciclos', async () => {
  const a = await createFolder(master, { name: 'Carpeta concurrente A' }),
    b = await createFolder(master, { name: 'Carpeta concurrente B' });
  const results = await Promise.allSettled([
    updateFolder(master, a.id, { name: a.name, parent_id: b.id }),
    updateFolder(master, b.id, { name: b.name, parent_id: a.id }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('La crónica completa, introducción y cierre no se comparten por asistencia', async () => {
  const r = await createRecord(master, {
    kind: 'session',
    title: 'Título secreto de sesión',
    body: 'Crónica',
    data: {
      introduction: 'Introducción privada',
      closing: 'Cierre durante la escena',
      participants: [char1, char2],
    },
  });
  const f = await addFragment(master, r.id, {
    title: 'Rumores de la taberna',
    body: 'Lo que le contaron al ausente.',
  });
  await reveal(master, f.id, { characters: [char2], source: 'le contaron' });
  assert.equal((await readRecord(p2, f.id)).body, 'Lo que le contaron al ausente.');
  await assert.rejects(readRecord(p1, f.id));
  await assert.rejects(readRecord(p2, r.id));
});
test('Los adjuntos privados, originales y de fragmentos requieren la misma autorización', async () => {
  const r = await createRecord(master, { kind: 'lore', title: 'Documento' });
  const f = await addFragment(master, r.id, { title: 'Carta recibida', body: 'Una carta.' });
  await reveal(master, f.id, { characters: [char1], source: 'leyó' });
  const data = Buffer.from('Texto de prueba');
  validateFile(data, 'text/plain');
  const key = randomUUID();
  await putObject(key, data, 'text/plain');
  const file = {
    id: randomUUID(),
    campaign_id: DEMO,
    record_id: r.id,
    fragment_id: f.id,
    name: 'carta.txt',
    mime: 'text/plain',
    size: data.length,
    object_key: key,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  await (
    await db()
  ).query(
    'INSERT INTO attachments(id,campaign_id,record_id,fragment_id,name,mime,size,object_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    Object.values(file),
  );
  assert(await canReadAttachment(p1, file));
  assert(!(await canReadAttachment(p2, file)));
  assert(!(await canReadAttachment(p1, { ...file, fragment_id: null })));
  assert((await readObject(key)).equals(data));
  await trashRecord(master, r.id);
  assert(!(await canReadAttachment(p1, file)));
  await trashRecord(master, r.id, true);
  assert(await canReadAttachment(p1, file));
});
test('Rechaza tipos falsificados, SVG y archivos excesivos', () => {
  assert.throws(() => validateFile(Buffer.from('<svg onload=alert(1)>'), 'image/png'));
  assert.throws(() => validateFile(Buffer.from('<svg/>'), 'image/svg+xml'));
  assert.throws(() => validateFile(Buffer.alloc(3 * 1024 * 1024 + 1), 'text/plain'));
});
test('Edición de fichas con lista de campos, persistencia, historial y conflictos de versión', async () => {
  const before = await readRecord(master, char1);
  const result = await updateRecord(p1, char1, {
    version: before.version,
    data: { playerNotes: 'Mi promesa para el próximo encuentro' },
  });
  assert.equal(
    (await readRecord(p1, char1)).data.playerNotes,
    'Mi promesa para el próximo encuentro',
  );
  assert.equal(result.data.playerNotes, 'Mi promesa para el próximo encuentro');
  await assert.rejects(
    updateRecord(p1, char1, { version: result.version, data: { sheet: { level: 99 } } }),
  );
  await assert.rejects(
    updateRecord(p2, char1, { version: result.version, data: { playerNotes: 'Ajeno' } }),
  );
  await assert.rejects(
    updateRecord(master, char1, { version: before.version, body: 'Conflicto' }),
    { status: 409 },
  );
  const restored = await restoreRevision(master, char1, {
    version: result.version,
    revision: before.version,
  });
  assert(restored.version > result.version);
});
test('Un jugador no ve notas privadas incrustadas fuera de los campos permitidos', async () => {
  const before = await readRecord(master, char1);
  await updateRecord(master, char1, {
    version: before.version,
    data: { ...before.data, privateMasterNotes: 'MOTIVACIÓN_PRIVADA' },
  });
  assert(!JSON.stringify(await readRecord(p1, char1)).includes('MOTIVACIÓN_PRIVADA'));
});
test('Aportaciones y mensajes no cambian canon ni aparecen a otros jugadores', async () => {
  const before = (await visibleRecords(p2)).length;
  await propose(p1, {
    title: 'Mi interpretación',
    body: 'Creo que la farera miente.',
    character_id: char1,
    type: 'relato',
  });
  assert.equal((await visibleRecords(p2)).length, before);
  const msg = await createRecord(master, {
    kind: 'message',
    title: 'Identidad real oculta',
    body: 'Borrador privado',
  });
  const f = await addFragment(master, msg.id, {
    title: 'Un susurro sin remitente',
    body: 'No regreses al muelle.',
  });
  await reveal(master, f.id, { characters: [char1], source: 'recibió' });
  await assert.rejects(readRecord(p2, f.id));
  assert.equal((await visibleRecords(p2, { search: 'susurro' })).length, 0);
});
test('Aislamiento de campañas y revocación inmediata de miembros', async () => {
  await assert.rejects(actorFor(DEMO_PLAYER1, randomUUID()), { status: 403 });
  await assert.rejects(setMember(master, DEMO_MASTER, false));
  await setMember(master, DEMO_PLAYER2, false);
  await assert.rejects(actorFor(DEMO_PLAYER2, DEMO), { status: 403 });
  await setMember(master, DEMO_PLAYER2, true);
  assert((await actorFor(DEMO_PLAYER2, DEMO)).role === 'player');
});
test('Vista como personaje tiene exactamente las revelaciones de ese personaje', async () => {
  const preview: Actor = { ...master, role: 'player', characterId: char2, preview: true };
  const real = (await visibleRecords(p2)).map((r) => r.id).sort();
  assert.deepEqual((await visibleRecords(preview)).map((r) => r.id).sort(), real);
});
test('Invitaciones, caducidad y suspensión no se saltan con un enlace de acceso', async () => {
  assert(await loginAllowed('lira@example.test'));
  assert(!(await loginAllowed('desconocido@example.test')));
  const email = 'invitado@example.test';
  await invite(master, { email, role: 'player' });
  assert(await loginAllowed(email));
  const id = randomUUID();
  await (await db()).query('INSERT INTO users(id,email) VALUES($1,$2)', [id, email]);
  await acceptInvitations(id, email);
  assert((await actorFor(id, DEMO)).role === 'player');
  await setMember(master, id, false);
  assert(!(await loginAllowed(email)));
  await acceptInvitations(id, email);
  await assert.rejects(actorFor(id, DEMO));
});
test('Limitación persistente de operaciones sensibles', async () => {
  await rateLimit('test-limit', 2);
  await rateLimit('test-limit', 2);
  await assert.rejects(rateLimit('test-limit', 2), { status: 429 });
});
test('Dados de servidor: gramática acotada, límites, ventaja y sin eval', () => {
  for (let i = 0; i < 100; i++) {
    const r = rollFormula('2d6+3');
    assert(r.total >= 5 && r.total <= 15);
  }
  const adv = rollFormula('1d20', 'ventaja');
  assert.equal(adv.total, Math.max(...adv.dice));
  const dis = rollFormula('1d20', 'desventaja');
  assert.equal(dis.total, Math.min(...dis.dice));
  for (const f of ['0d20', '99d6', '1d7', 'process.exit()', '1d20+1d6', '2d6;alert(1)'])
    assert.throws(() => rollFormula(f));
  assert.throws(() => rollFormula('2d20', 'ventaja'));
});
test('Bitácoras privadas, compartir explícitamente y edición reservada al autor', async () => {
  const j = await community.createJournal(p1, {
    character_id: char1,
    type: 'momento',
    title: 'MI_BORRADOR_PRIVADO',
    body: 'Una interpretación, no canon.',
    significance: 'Una promesa',
  });
  assert(!(await community.journals(master)).some((r) => r.id === j.id));
  assert(!(await community.journals(p2)).some((r) => r.id === j.id));
  const own = (await community.journals(p1)).find((r) => r.id === j.id)!;
  await community.editJournal(p1, j.id, {
    version: own.version,
    title: own.title,
    body: own.body,
    shared_master: true,
    recipients: [char2],
  });
  assert((await community.journals(master)).some((r) => r.id === j.id));
  assert((await community.journals(p2)).some((r) => r.id === j.id));
  await assert.rejects(
    community.editJournal(p2, j.id, {
      version: 2,
      title: 'Ajeno',
      body: 'Intrusión',
      shared_master: true,
      recipients: [],
    }),
  );
});
test('Correspondencia: borrador invisible, remitente real privado, conversación solo autorizada', async () => {
  const t = await community.createThread(master, {
    character_id: char1,
    title: 'Un sueño',
    visible_sender: 'Una voz',
    real_sender: 'DEIDAD_OCULTA',
    body: 'Despertá.',
    replies_enabled: true,
  });
  assert(!(await community.threads(p1)).some((r) => r.id === t.id));
  await community.sendThread(master, t.id);
  const visible = await community.threadDetail(p1, t.id);
  assert(!JSON.stringify(visible).includes('DEIDAD_OCULTA'));
  await assert.rejects(community.threadDetail(p2, t.id));
  assert(!(await community.threads(p2)).some((r) => r.id === t.id));
  await community.replyThread(p1, t.id, { body: '¿Quién sos?' });
  assert.equal((await community.threadDetail(master, t.id)).messages.length, 2);
  const noReply = await community.createThread(master, {
    character_id: char1,
    title: 'Sin respuesta',
    visible_sender: 'Un recuerdo',
    body: 'Silencio.',
    send: true,
  });
  await assert.rejects(community.replyThread(p1, noReply.id, { body: 'Intrusión' }), {
    status: 403,
  });
});
test('Productos y dinero: ninguna mercancía privada se filtra; conversión exacta sin flotantes', async () => {
  const coin = await commerce.createCurrency(master, {
    name: 'Moneda ficticia',
    symbol: 'mf',
    base_units: '100',
  });
  assert(coin.id);
  const product = await commerce.createProduct(master, {
    private_name: 'NOMBRE_REAL_SECRETO',
    known_name: 'Un frasco sellado',
    shop_name: 'Puesto de prueba',
    private_notes: 'PROPIEDAD_SECRETA',
    stock: 2,
    base_price: '900719925474099',
  });
  assert(!(await commerce.commerce(p1)).products.some((r) => r.id === product.id));
  await commerce.revealProduct(master, product.id, {
    characters: [char1],
    offered_price: '17',
    stock_visibility: 'disponible',
  });
  const visible = (await commerce.commerce(p1)).products.find((r) => r.id === product.id)!;
  assert.equal(visible.offered_price, '17');
  assert(!JSON.stringify(visible).includes('NOMBRE_REAL_SECRETO'));
  assert(!JSON.stringify(visible).includes('PROPIEDAD_SECRETA'));
  assert(!Object.hasOwn(visible, 'stock'));
  assert(!(await commerce.commerce(p2)).products.some((r) => r.id === product.id));
  await commerce.adjustWallet(master, {
    character_id: char1,
    amount: '900719925474099',
    idempotency_key: randomUUID(),
  });
  assert.equal(
    (await commerce.commerce(p1)).wallets.find((w) => w.character_id === char1)!.balance,
    '900719925474099',
  );
});
test('Compra atómica: dinero insuficiente revierte el stock y confirmar dos veces no duplica', async () => {
  const product = await commerce.createProduct(master, {
    private_name: 'Objeto prueba',
    known_name: 'Objeto conocido',
    shop_name: 'Tienda ficticia',
    stock: 3,
    base_price: '20',
  });
  await commerce.revealProduct(master, product.id, {
    characters: [char2],
    offered_price: '20',
    stock_visibility: 'exacta',
  });
  const key = randomUUID();
  const purchase = await commerce.requestPurchase(p2, {
    character_id: char2,
    product_id: product.id,
    quantity: 2,
    idempotency_key: key,
  });
  assert.equal(
    (
      await commerce.requestPurchase(p2, {
        character_id: char2,
        product_id: product.id,
        quantity: 2,
        idempotency_key: key,
      })
    ).id,
    purchase.id,
  );
  await assert.rejects(commerce.confirmPurchase(master, purchase.id, {}), { status: 409 });
  assert.equal(
    (await commerce.commerce(master)).products.find((p) => p.id === product.id)!.stock,
    3,
  );
  await commerce.adjustWallet(master, {
    character_id: char2,
    amount: '100',
    idempotency_key: randomUUID(),
  });
  await Promise.all([
    commerce.confirmPurchase(master, purchase.id, {}),
    commerce.confirmPurchase(master, purchase.id, {}),
  ]);
  const state = await commerce.commerce(p2);
  assert.equal(state.wallets.find((w) => w.character_id === char2)!.balance, '60');
  assert.equal(
    state.inventory
      .filter((i) => i.source === 'compra confirmada')
      .reduce((s, i) => s + i.quantity, 0),
    2,
  );
  assert.equal(
    (await commerce.commerce(master)).products.find((p) => p.id === product.id)!.stock,
    1,
  );
});
test('Compras simultáneas no venden dos veces el último objeto', async () => {
  const product = await commerce.createProduct(master, {
    private_name: 'Última unidad',
    known_name: 'Objeto único de prueba',
    shop_name: 'Tienda',
    stock: 1,
    base_price: '1',
  });
  await commerce.revealProduct(master, product.id, {
    characters: [char1, char2],
    offered_price: '1',
    stock_visibility: 'disponible',
  });
  const a = await commerce.requestPurchase(p1, {
      character_id: char1,
      product_id: product.id,
      quantity: 1,
      idempotency_key: randomUUID(),
    }),
    b = await commerce.requestPurchase(p2, {
      character_id: char2,
      product_id: product.id,
      quantity: 1,
      idempotency_key: randomUUID(),
    });
  const result = await Promise.allSettled([
    commerce.confirmPurchase(master, a.id, {}),
    commerce.confirmPurchase(master, b.id, {}),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(result.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(
    (await commerce.commerce(master)).products.find((p) => p.id === product.id)!.stock,
    0,
  );
});
test('Entregas y transferencias idempotentes: propiedad separada de conocimiento', async () => {
  const key = randomUUID();
  await Promise.all([
    commerce.deliverItem(master, {
      character_id: char1,
      name: 'Carta física',
      description: 'Lo que se puede leer',
      private_notes: 'SECRETO_NO_ENTREGADO',
      quantity: 1,
      idempotency_key: key,
    }),
    commerce.deliverItem(master, {
      character_id: char1,
      name: 'Carta física',
      quantity: 1,
      idempotency_key: key,
    }),
  ]);
  const inv = (await commerce.commerce(p1)).inventory.filter((i) => i.name === 'Carta física');
  assert.equal(inv.length, 1);
  assert(!JSON.stringify(inv).includes('SECRETO_NO_ENTREGADO'));
  const transferKey = randomUUID();
  await commerce.transferItem(master, inv[0].id, {
    to_character_id: char2,
    quantity: 1,
    idempotency_key: transferKey,
  });
  await commerce.transferItem(master, inv[0].id, {
    to_character_id: char2,
    quantity: 1,
    idempotency_key: transferKey,
  });
  assert.equal(
    (await commerce.commerce(p2)).inventory.filter((i) => i.name === 'Carta física').length,
    1,
  );
  assert(!(await commerce.commerce(p1)).inventory.some((i) => i.id === inv[0].id));
  await assert.rejects(
    commerce.deliverItem(p1, {
      character_id: char1,
      name: 'Intrusión',
      quantity: 1,
      idempotency_key: randomUUID(),
    }),
  );
});
test('API opcional: credenciales acotadas, revocables y sin publicación', async () => {
  const t = await createIntegration(master, { name: 'Prueba aislada', scopes: ['draft'] });
  const identity = await integrationFromHeader('Bearer ' + t.token);
  assert(identity);
  checkIntegration(identity, 'POST', ['campaigns', DEMO, 'records']);
  assert.throws(() => checkIntegration(identity, 'GET', ['campaigns', DEMO, 'overview']));
  assert.throws(() =>
    checkIntegration(identity, 'POST', ['campaigns', DEMO, 'fragments', randomUUID()]),
  );
  assert.throws(() => checkIntegration(identity, 'POST', ['campaigns', randomUUID(), 'records']));
  await revokeIntegration(master, t.id);
  await assert.rejects(integrationFromHeader('Bearer ' + t.token));
  await assert.rejects(createIntegration(p1, { name: 'Intrusión', scopes: ['read'] }));
});
test('Las exportaciones del máster no filtran borradores privados de jugadores', async () => {
  await community.createJournal(p1, {
    character_id: char1,
    type: 'bitácora',
    title: 'BORRADOR_PERSONAL_NO_EXPORTABLE',
    body: 'PRIVADO_DE_VERDAD',
  });
  const permitted = await exportCampaign(master);
  assert(!JSON.stringify(permitted).includes('BORRADOR_PERSONAL_NO_EXPORTABLE'));
  const operator = await exportCampaign(master, { operator: true });
  assert(JSON.stringify(operator).includes('BORRADOR_PERSONAL_NO_EXPORTABLE'));
});
test('Respaldo con datos, originales, relaciones e historial; restauración en otra base verificada', async () => {
  const backup = await exportCampaign(master, { operator: true });
  assert(backup.files.length > 0);
  const target = await mkdtemp(path.join(tmpdir(), 'aetherfall-restore-'));
  const file = path.join(target, 'backup.json');
  await writeFile(file, JSON.stringify(backup), { mode: 0o600 });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/restore-check.ts', file], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AETHERFALL_LOCAL_DIR: target,
      DATABASE_URL: '',
      AETHERFALL_TEST_DATABASE_URL: '',
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert(result.stdout.includes('RESTORE_OK'));
  await assert.rejects(exportCampaign(p1));
});

test('Restaurar un respaldo con referencias de Drive reasigna originales sin necesitar la nube de origen', async () => {
  const backup = await exportCampaign(master, { operator: true });
  const cloned = JSON.parse(JSON.stringify(backup));
  const attachment = cloned.data.attachments[0];
  const originalKey = attachment.object_key;
  const driveRef = 'drive:source_file_ficticio_123';
  for (const f of cloned.data.attachments)
    if (f.object_key === originalKey) f.object_key = driveRef;
  cloned.files.find((f: any) => f.key === originalKey).key = driveRef;
  const target = await mkdtemp(path.join(tmpdir(), 'aetherfall-drive-restore-'));
  const file = path.join(target, 'backup.json');
  await writeFile(file, JSON.stringify(cloned), { mode: 0o600 });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/restore-check.ts', file], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AETHERFALL_LOCAL_DIR: target,
      DATABASE_URL: '',
      AETHERFALL_TEST_DATABASE_URL: '',
      STORAGE_PROVIDER: 'local',
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert(result.stdout.includes('RESTORE_OK'));
  assert.equal(
    backup.data.attachments && (backup.data.attachments as any[])[0].object_key,
    originalKey,
  );
});

test('Elección única: privacidad, concurrencia y cambios exclusivos del máster', async () => {
  const { characterChoices, claimCharacter } = await import('../lib/character-selection');
  async function player() {
    const id = randomUUID();
    await (
      await db()
    ).query('INSERT INTO users(id,email) VALUES($1,$2)', [id, `${id}@example.test`]);
    await (
      await db()
    ).query("INSERT INTO members(campaign_id,user_id,role,active) VALUES($1,$2,'player',true)", [
      DEMO,
      id,
    ]);
    return actorFor(id, DEMO);
  }
  const a = await player(),
    b = await player();
  const first = await createRecord(master, {
    kind: 'character',
    title: 'Elegible uno',
    body: 'SECRETO',
    data: { selfSelectable: true, secret: 'OCULTO' },
  });
  const second = await createRecord(master, {
    kind: 'character',
    title: 'Elegible dos',
    data: { selfSelectable: true },
  });
  const hidden = await createRecord(master, { kind: 'character', title: 'Oculto', data: {} });
  const choices = await characterChoices(a);
  assert(choices.available.some((c) => c.id === first.id));
  assert(!choices.available.some((c) => c.id === hidden.id));
  assert(choices.available.every((c) => Object.keys(c).sort().join(',') === 'id,title'));
  await assert.rejects(claimCharacter(a, hidden.id));
  const samePlayer = await Promise.allSettled([
    claimCharacter(a, first.id),
    claimCharacter(a, second.id),
  ]);
  assert.equal(samePlayer.filter((r) => r.status === 'fulfilled').length, 1);
  const own = await one(
    "SELECT id FROM records WHERE campaign_id=$1 AND owner_id=$2 AND kind='character'",
    [DEMO, a.userId],
  );
  const free = own!.id === first.id ? second : first;
  await assert.rejects(claimCharacter(a, free.id));
  assert.deepEqual(await characterChoices(a), { locked: true, available: [] });
  await assert.rejects(assignCharacter(a, free.id, { user_id: a.userId }));
  await assert.rejects(assignCharacter(master, free.id, { user_id: a.userId }));
  await assignCharacter(master, own!.id, { user_id: null });
  await assert.rejects(claimCharacter(a, free.id));
  await assignCharacter(master, free.id, { user_id: a.userId });
  await trashRecord(master, free.id);
  await assignCharacter(master, own!.id, { user_id: a.userId });
  await assert.rejects(trashRecord(master, free.id, true));
  const c = await player();
  const shared = await createRecord(master, {
    kind: 'character',
    title: 'Competido',
    data: { selfSelectable: true },
  });
  const race = await Promise.allSettled([
    claimCharacter(b, shared.id),
    claimCharacter(c, shared.id),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(claimCharacter({ ...b, preview: true }, shared.id));
  await assert.rejects(claimCharacter(master, shared.id));
});
