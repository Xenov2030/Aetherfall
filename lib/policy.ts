import { db, one, type DB, type Row } from './db';
import { assert } from './errors';
export type Actor = {
  userId: string;
  campaignId: string;
  role: 'master' | 'player';
  characterId?: string;
  preview?: boolean;
};
export async function actorFor(
  userId: string,
  campaignId: string,
  characterId?: string,
): Promise<Actor> {
  const m = await one(
    'SELECT role FROM members WHERE user_id=$1 AND campaign_id=$2 AND active=true',
    [userId, campaignId],
  );
  assert(m, 403, 'No tenés acceso a esta campaña');
  if (characterId) {
    const ch = await one(
      "SELECT id FROM records WHERE id=$1 AND campaign_id=$2 AND kind='character' AND deleted_at IS NULL AND ($3='master' OR owner_id=$4)",
      [characterId, campaignId, m.role, userId],
    );
    assert(ch);
  }
  return { userId, campaignId, role: m.role, characterId };
}
export function master(a: Actor) {
  assert(a.role === 'master', 403, 'Esta acción requiere el rol de máster');
}
export async function characterIds(a: Actor, conn?: DB): Promise<string[]> {
  const rows = (
    await (conn ?? (await db())).query(
      "SELECT id FROM records WHERE campaign_id=$1 AND kind='character' AND deleted_at IS NULL AND ($2='master' OR owner_id=$3) AND ($4::uuid IS NULL OR id=$4)",
      [a.campaignId, a.preview ? 'master' : a.role, a.userId, a.characterId ?? null],
    )
  ).rows;
  return rows.map((r) => r.id);
}
// All player projections are allowlists. Private record titles, folders, metadata and relationships never leave here.
export async function visibleRecords(
  a: Actor,
  options: { deleted?: boolean; search?: string } = {},
): Promise<Row[]> {
  const conn = await db();
  if (a.role === 'master')
    return (
      await conn.query(
        "SELECT * FROM records WHERE campaign_id=$1 AND kind<>'roll' AND (deleted_at IS NOT NULL)=$2 AND ($3='' OR title ILIKE $4 OR body ILIKE $4) ORDER BY updated_at DESC",
        [a.campaignId, !!options.deleted, options.search ?? '', `%${options.search ?? ''}%`],
      )
    ).rows;
  if (options.deleted) return [];
  const ids = await characterIds(a);
  if (!ids.length) return [];
  const owned = (
    await conn.query(
      'SELECT id,kind,title,data,version,updated_at FROM records WHERE campaign_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL',
      [a.campaignId, ids],
    )
  ).rows;
  const revealed = (
    await conn.query(
      `SELECT f.id,f.record_id,f.title,f.body,f.version,r.kind,g.source,g.granted_at,g.opened_at,g.character_id FROM fragments f JOIN records r ON r.id=f.record_id JOIN grants g ON g.fragment_id=f.id WHERE f.campaign_id=$1 AND g.character_id=ANY($2::uuid[]) AND r.deleted_at IS NULL ORDER BY g.granted_at DESC`,
      [a.campaignId, ids],
    )
  ).rows;
  const safeOwned: Row[] = owned.map((r) => ({ ...r, data: playerSheet(r.data) }));
  return [...safeOwned, ...revealed.map((r): Row => ({ ...r, fragment: true }))].filter(
    (r) =>
      !options.search ||
      `${r.title} ${r.body ?? ''}`.toLowerCase().includes(options.search.toLowerCase()),
  );
}
export function playerSheet(data: Row) {
  return Object.fromEntries(
    ['identity', 'sheet', 'inventory', 'coins', 'editable', 'playerNotes', 'resources', 'portrait']
      .filter((k) => Object.hasOwn(data, k))
      .map((k) => [k, data[k]]),
  );
}
export async function readRecord(a: Actor, id: string) {
  const visible = await visibleRecords(a);
  const r = visible.find((r) => r.id === id);
  assert(r);
  return r;
}
export async function canReadAttachment(a: Actor, file: Row) {
  if (file.campaign_id !== a.campaignId) return false;
  if (
    !(await one('SELECT id FROM records WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL', [
      file.record_id,
      a.campaignId,
    ]))
  )
    return false;
  if (a.role === 'master') return true;
  if (!file.fragment_id) return false;
  return !!(await one(
    'SELECT fragment_id FROM grants WHERE fragment_id=$1 AND campaign_id=$2 AND character_id=ANY($3::uuid[])',
    [file.fragment_id, a.campaignId, await characterIds(a)],
  ));
}
