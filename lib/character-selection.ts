import { db, one, type DB } from './db';
import { assert } from './errors';
import { type Actor } from './policy';
import { INITIAL_CHARACTER_NAMES } from './character-catalog';
import { audit } from './service';
import { randomUUID } from 'node:crypto';

const eligible = `(r.data->'selfSelectable'='true'::jsonb OR (NOT (r.data ? 'selfSelectable') AND r.title=ANY($2::text[]) AND jsonb_typeof(r.data->'playerLabel')='string'))`;
export async function selectionLocked(a: Actor, tx?: DB) {
  const result = await one(
    `SELECT (
    EXISTS(SELECT 1 FROM records WHERE campaign_id=$1 AND kind='character' AND owner_id=$2)
    OR EXISTS(SELECT 1 FROM audit WHERE campaign_id=$1 AND (
      (action='elegir-personaje' AND actor_id=$2)
      OR (action='asignar' AND (details->>'previousOwner'=$2::text OR details->>'newOwner'=$2::text))
    ))
    OR EXISTS(SELECT 1 FROM revisions v JOIN records r ON r.id=v.record_id WHERE v.campaign_id=$1 AND r.kind='character' AND v.snapshot->>'owner_id'=$2::text)
  ) AS locked`,
    [a.campaignId, a.userId],
    tx,
  );
  return result?.locked === true;
}
export async function characterChoices(a: Actor) {
  if (a.role !== 'player' || a.preview) return { locked: true, available: [] };
  const locked = await selectionLocked(a);
  if (locked) return { locked: true, available: [] };
  const available = (
    await (
      await db()
    ).query(
      `SELECT r.id,r.title FROM records r WHERE r.campaign_id=$1 AND r.kind='character' AND r.owner_id IS NULL AND r.deleted_at IS NULL AND ${eligible} ORDER BY r.title`,
      [a.campaignId, INITIAL_CHARACTER_NAMES],
    )
  ).rows;
  return { locked: false, available };
}
export async function claimCharacter(a: Actor, id: string) {
  assert(a.role === 'player' && !a.preview, 403, 'Solo un jugador puede hacer su elección inicial');
  return (await db()).transaction(async (tx) => {
    await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [a.campaignId]);
    const member = await one(
      'SELECT role,active FROM members WHERE campaign_id=$1 AND user_id=$2 FOR UPDATE',
      [a.campaignId, a.userId],
      tx,
    );
    assert(
      member?.active && member.role === 'player',
      403,
      'No tenés acceso de jugador a esta campaña',
    );
    const own = await one(
      "SELECT id,title FROM records WHERE campaign_id=$1 AND kind='character' AND owner_id=$2 AND deleted_at IS NULL",
      [a.campaignId, a.userId],
      tx,
    );
    if (own?.id === id) return { character: own, locked: true };
    assert(
      !(await selectionLocked(a, tx)),
      403,
      'Tu personaje ya quedó asignado. Solo el máster puede cambiarlo.',
    );
    const character = await one(
      `SELECT r.*,${eligible} AS selectable FROM records r WHERE r.campaign_id=$1 AND r.id=$3 AND r.kind='character' AND r.deleted_at IS NULL FOR UPDATE`,
      [a.campaignId, INITIAL_CHARACTER_NAMES, id],
      tx,
    );
    assert(
      character && character.owner_id === null && character.selectable === true,
      409,
      'Ese personaje ya no está disponible. Elegí otro de la lista.',
    );
    const updated = await one(
      'UPDATE records SET owner_id=$3,version=version+1,updated_at=now() WHERE id=$1 AND campaign_id=$2 RETURNING *',
      [id, a.campaignId, a.userId],
      tx,
    );
    await tx.query(
      'INSERT INTO revisions(id,campaign_id,record_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), a.campaignId, id, updated!.version, JSON.stringify(updated), a.userId],
    );
    await audit(tx, a, 'elegir-personaje', id);
    return { character: { id: updated!.id, title: updated!.title }, locked: true };
  });
}
