import { z } from 'zod';
import { randomUUID, randomInt } from 'node:crypto';
import { db, one, type DB, type Row } from './db';
import { assert } from './errors';
import { master, readRecord, playerSheet, characterIds, type Actor } from './policy';
export const kinds = [
  'session',
  'character',
  'lore',
  'npc',
  'villain',
  'relic',
  'mechanic',
  'idea',
  'journal',
  'moment',
  'message',
  'quest',
  'pending',
  'attendance',
  'proposal',
  'roll',
] as const;
const recordSchema = z.object({
  kind: z.enum(kinds),
  title: z.string().trim().min(1).max(180),
  body: z.string().max(60000).default(''),
  status: z
    .enum([
      'vigente',
      'planeado',
      'rumor',
      'descartado',
      'borrador',
      'final',
      'pendiente',
      'realizada',
    ])
    .default('borrador'),
  folder_id: z.uuid().nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export async function audit(tx: DB, a: Actor, action: string, target: string, details: Row = {}) {
  await tx.query(
    'INSERT INTO audit(id,campaign_id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), a.campaignId, a.userId, action, target, JSON.stringify(details)],
  );
}
async function snapshot(tx: DB, a: Actor, r: Row) {
  await tx.query(
    'INSERT INTO revisions(id,campaign_id,record_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), a.campaignId, r.id, r.version, JSON.stringify(r), a.userId],
  );
}
export async function createRecord(a: Actor, input: unknown) {
  master(a);
  const data = recordSchema.parse(input);
  const id = randomUUID();
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        'INSERT INTO records(id,campaign_id,kind,title,body,status,folder_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          id,
          a.campaignId,
          data.kind,
          data.title,
          data.body,
          data.status,
          data.folder_id ?? null,
          JSON.stringify(data.data),
        ],
      )
    ).rows[0];
    await snapshot(tx, a, r);
    await audit(tx, a, 'crear', id);
    return r;
  });
}
export async function updateRecord(a: Actor, id: string, input: unknown) {
  const data = z
    .object({
      version: z.number().int().positive(),
      title: z.string().trim().min(1).max(180).optional(),
      body: z.string().max(60000).optional(),
      status: z
        .enum([
          'vigente',
          'planeado',
          'rumor',
          'descartado',
          'borrador',
          'final',
          'pendiente',
          'realizada',
        ])
        .optional(),
      folder_id: z.uuid().nullable().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .parse(input);
  return (await db()).transaction(async (tx) => {
    const old = await one(
      'SELECT * FROM records WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [id, a.campaignId],
      tx,
    );
    assert(old);
    let patch: Row = data;
    if (a.role !== 'master') {
      assert(
        old.kind === 'character' &&
          old.owner_id === a.userId &&
          (!a.characterId || a.characterId === id),
        403,
        'No podés editar esta ficha',
      );
      assert(
        !data.title && !data.body && !data.status && !Object.hasOwn(data, 'folder_id'),
        403,
        'Los cambios estructurales requieren al máster',
      );
      const keys = Object.keys(data.data ?? {});
      assert(
        keys.every(
          (k) => ['playerNotes', 'resources'].includes(k) && old.data.editable?.includes(k),
        ),
        403,
        'Este campo no está habilitado para edición',
      );
      patch = { version: data.version, data: { ...old.data, ...data.data } };
    }
    assert(old.version === data.version, 409, 'El contenido cambió. Actualizá antes de guardar.');
    const r = (
      await tx.query(
        'UPDATE records SET title=$3,body=$4,status=$5,folder_id=$6,data=$7,version=version+1,updated_at=now() WHERE id=$1 AND campaign_id=$2 RETURNING *',
        [
          id,
          a.campaignId,
          patch.title ?? old.title,
          patch.body ?? old.body,
          patch.status ?? old.status,
          Object.hasOwn(patch, 'folder_id') ? patch.folder_id : old.folder_id,
          JSON.stringify(patch.data ?? old.data),
        ],
      )
    ).rows[0];
    await snapshot(tx, a, r);
    await audit(tx, a, 'editar', id, { version: r.version });
    return a.role === 'master'
      ? r
      : {
          id: r.id,
          title: r.title,
          kind: r.kind,
          version: r.version,
          data: playerSheet(r.data),
          updated_at: r.updated_at,
        };
  });
}
export async function trashRecord(a: Actor, id: string, restore = false) {
  master(a);
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        'UPDATE records SET deleted_at=CASE WHEN $3 THEN NULL ELSE now() END,version=version+1,updated_at=now() WHERE id=$1 AND campaign_id=$2 RETURNING *',
        [id, a.campaignId, restore],
      )
    ).rows[0];
    assert(r);
    await snapshot(tx, a, r);
    await audit(tx, a, restore ? 'restaurar' : 'papelera', id);
    return r;
  });
}
export async function addFragment(a: Actor, recordId: string, input: unknown) {
  master(a);
  const p = z
    .object({ title: z.string().trim().min(1).max(180), body: z.string().max(60000) })
    .parse(input);
  await readRecord(a, recordId);
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        'INSERT INTO fragments(id,campaign_id,record_id,title,body) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [randomUUID(), a.campaignId, recordId, p.title, p.body],
      )
    ).rows[0];
    await audit(tx, a, 'fragmento-borrador', r.id);
    return r;
  });
}
export async function reveal(a: Actor, fragmentId: string, input: unknown) {
  master(a);
  const p = z
    .object({
      characters: z.array(z.uuid()).min(1).max(100),
      source: z.enum(['presenció', 'le contaron', 'leyó', 'recibió']),
      revoke: z.boolean().default(false),
    })
    .parse(input);
  return (await db()).transaction(async (tx) => {
    const f = await one(
      'SELECT f.id FROM fragments f JOIN records r ON r.id=f.record_id WHERE f.id=$1 AND f.campaign_id=$2 AND r.deleted_at IS NULL',
      [fragmentId, a.campaignId],
      tx,
    );
    assert(f);
    for (const id of new Set(p.characters)) {
      const ch = await one(
        "SELECT id FROM records WHERE id=$1 AND campaign_id=$2 AND kind='character' AND deleted_at IS NULL",
        [id, a.campaignId],
        tx,
      );
      assert(ch);
      if (p.revoke)
        await tx.query('DELETE FROM grants WHERE fragment_id=$1 AND character_id=$2', [
          fragmentId,
          id,
        ]);
      else
        await tx.query(
          'INSERT INTO grants(campaign_id,fragment_id,character_id,source) VALUES($1,$2,$3,$4) ON CONFLICT(fragment_id,character_id) DO UPDATE SET source=excluded.source',
          [a.campaignId, fragmentId, id, p.source],
        );
    }
    await audit(tx, a, p.revoke ? 'retirar-acceso' : 'revelar', fragmentId, {
      characters: p.characters,
      source: p.source,
    });
    return { ok: true };
  });
}
export async function createFolder(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({ name: z.string().trim().min(1).max(100), parent_id: z.uuid().nullable().optional() })
    .parse(input);
  if (p.parent_id)
    assert(
      await one('SELECT id FROM folders WHERE id=$1 AND campaign_id=$2', [
        p.parent_id,
        a.campaignId,
      ]),
    );
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        'INSERT INTO folders(id,campaign_id,parent_id,name) VALUES($1,$2,$3,$4) RETURNING *',
        [randomUUID(), a.campaignId, p.parent_id ?? null, p.name],
      )
    ).rows[0];
    await audit(tx, a, 'carpeta', r.id);
    return r;
  });
}
export async function updateFolder(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z
    .object({ name: z.string().trim().min(1).max(100), parent_id: z.uuid().nullable() })
    .parse(input);
  return (await db()).transaction(async (tx) => {
    await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [a.campaignId]);
    assert(
      await one(
        'SELECT id FROM folders WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [id, a.campaignId],
        tx,
      ),
    );
    if (p.parent_id) {
      assert(
        await one(
          'SELECT id FROM folders WHERE id=$1 AND campaign_id=$2',
          [p.parent_id, a.campaignId],
          tx,
        ),
      );
      const cycle = await one(
        'WITH RECURSIVE parents AS (SELECT id,parent_id FROM folders WHERE id=$1 AND campaign_id=$2 UNION ALL SELECT f.id,f.parent_id FROM folders f JOIN parents p ON f.id=p.parent_id) SELECT id FROM parents WHERE id=$3',
        [p.parent_id, a.campaignId, id],
        tx,
      );
      assert(!cycle, 400, 'Una carpeta no puede contenerse a sí misma');
    }
    await tx.query('UPDATE folders SET name=$3,parent_id=$4 WHERE id=$1 AND campaign_id=$2', [
      id,
      a.campaignId,
      p.name,
      p.parent_id,
    ]);
    await audit(tx, a, 'editar-carpeta', id);
    return { ok: true };
  });
}
export async function assignCharacter(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z.object({ user_id: z.uuid().nullable() }).parse(input);
  if (p.user_id)
    assert(
      await one('SELECT user_id FROM members WHERE user_id=$1 AND campaign_id=$2 AND active=true', [
        p.user_id,
        a.campaignId,
      ]),
    );
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        "UPDATE records SET owner_id=$3,version=version+1,updated_at=now() WHERE id=$1 AND campaign_id=$2 AND kind='character' AND deleted_at IS NULL RETURNING *",
        [id, a.campaignId, p.user_id],
      )
    ).rows[0];
    assert(r);
    await snapshot(tx, a, r);
    await audit(tx, a, 'asignar', id);
    return r;
  });
}
export async function invite(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({ email: z.email().max(254), role: z.enum(['master', 'player']).default('player') })
    .parse(input);
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        `INSERT INTO invitations(id,campaign_id,email,role,expires) VALUES($1,$2,$3,$4,now()+interval '7 days') ON CONFLICT(campaign_id,email) DO UPDATE SET role=excluded.role,expires=excluded.expires,accepted_at=NULL RETURNING id,email,role,expires`,
        [randomUUID(), a.campaignId, p.email.toLowerCase(), p.role],
      )
    ).rows[0];
    await audit(tx, a, 'invitar', r.id);
    return r;
  });
}
export async function setMember(a: Actor, userId: string, active: boolean) {
  master(a);
  assert(userId !== a.userId, 400, 'No podés desactivar tu propio acceso');
  return (await db()).transaction(async (tx) => {
    const r = await one(
      'UPDATE members SET active=$3 WHERE campaign_id=$1 AND user_id=$2 RETURNING user_id',
      [a.campaignId, userId, active],
      tx,
    );
    assert(r);
    await audit(tx, a, active ? 'activar-miembro' : 'desactivar-miembro', userId);
    return { ok: true };
  });
}
export async function propose(a: Actor, input: unknown) {
  assert(a.role === 'player', 400, 'Las propuestas son aportaciones de jugadores');
  const p = z
    .object({
      title: z.string().trim().min(1).max(180),
      body: z.string().max(20000),
      character_id: z.uuid(),
      type: z.enum(['npc', 'relato', 'pendiente', 'compartir', 'ficha', 'intención']),
    })
    .parse(input);
  assert((await characterIds(a)).includes(p.character_id));
  return (await db()).transaction(async (tx) => {
    const r = (
      await tx.query(
        "INSERT INTO records(id,campaign_id,kind,title,body,status,owner_id,data) VALUES($1,$2,'proposal',$3,$4,'pendiente',$5,$6) RETURNING id",
        [
          randomUUID(),
          a.campaignId,
          p.title,
          p.body,
          a.userId,
          JSON.stringify({ character_id: p.character_id, type: p.type }),
        ],
      )
    ).rows[0];
    await audit(tx, a, 'proponer', r.id);
    return r;
  });
}
export async function restoreRevision(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z
    .object({ version: z.number().int().positive(), revision: z.number().int().positive() })
    .parse(input);
  const rev = await one(
    'SELECT snapshot FROM revisions WHERE campaign_id=$1 AND record_id=$2 AND version=$3',
    [a.campaignId, id, p.revision],
  );
  assert(rev);
  const { title, body, status, folder_id, data } = rev.snapshot;
  return updateRecord(a, id, { version: p.version, title, body, status, folder_id, data });
}
export function rollFormula(formula: string, mode: 'normal' | 'ventaja' | 'desventaja' = 'normal') {
  const m = /^(\d{1,2})d(4|6|8|10|12|20|100)([+-]\d{1,4})?$/.exec(formula.replace(/\s/g, ''));
  assert(m, 400, 'Usá una fórmula como 2d6+3');
  const count = Number(m[1]),
    sides = Number(m[2]),
    modifier = Number(m[3] ?? 0);
  assert(count >= 1 && count <= 30, 400, 'Entre 1 y 30 dados');
  assert(
    mode === 'normal' || (count === 1 && sides === 20),
    400,
    'Ventaja y desventaja requieren 1d20',
  );
  const dice = Array.from({ length: mode === 'normal' ? count : 2 }, () => randomInt(1, sides + 1));
  const base =
    mode === 'ventaja'
      ? Math.max(...dice)
      : mode === 'desventaja'
        ? Math.min(...dice)
        : dice.reduce((s, n) => s + n, 0);
  return { formula, mode, dice, modifier, total: base + modifier };
}
export async function roll(a: Actor, input: unknown) {
  const p = z
    .object({
      formula: z.string().max(30),
      mode: z.enum(['normal', 'ventaja', 'desventaja']).default('normal'),
    })
    .parse(input);
  const result = rollFormula(p.formula, p.mode);
  const id = randomUUID();
  await (
    await db()
  ).query(
    "INSERT INTO records(id,campaign_id,kind,title,owner_id,data) VALUES($1,$2,'roll',$3,$4,$5)",
    [id, a.campaignId, p.formula, a.userId, JSON.stringify(result)],
  );
  return { id, ...result };
}
