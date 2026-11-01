import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { db, one } from './db';
import { assert } from './errors';
import { actorFor, master, type Actor } from './policy';
import { audit } from './service';
export type Integration = { id: string; userId: string; campaignId: string; scopes: string[] };
export async function integrationFromHeader(header: string | null): Promise<Integration | null> {
  if (!header) return null;
  assert(/^Bearer aef_[A-Za-z0-9_-]{43}$/.test(header), 401, 'Credencial de integración inválida');
  const hash = createHash('sha256').update(header.slice(7)).digest('hex');
  const r = await one(
    'SELECT id,campaign_id,user_id,scopes FROM integration_tokens WHERE token_hash=$1 AND revoked_at IS NULL',
    [hash],
  );
  assert(r, 401, 'Credencial de integración inválida');
  const a = await actorFor(r.user_id, r.campaign_id);
  master(a);
  return { id: r.id, userId: r.user_id, campaignId: r.campaign_id, scopes: r.scopes };
}
export async function createIntegration(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      name: z.string().trim().min(1).max(80),
      scopes: z
        .array(z.enum(['read', 'draft', 'files', 'folders']))
        .min(1)
        .max(4),
    })
    .parse(input);
  const token = 'aef_' + randomBytes(32).toString('base64url'),
    id = randomUUID();
  await (
    await db()
  ).transaction(async (tx) => {
    await tx.query(
      'INSERT INTO integration_tokens(id,campaign_id,user_id,name,token_hash,scopes) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        a.campaignId,
        a.userId,
        p.name,
        createHash('sha256').update(token).digest('hex'),
        p.scopes,
      ],
    );
    await audit(tx, a, 'crear-integración', id);
  });
  return { id, token, name: p.name, scopes: p.scopes };
}
export async function listIntegrations(a: Actor) {
  master(a);
  return (
    await (
      await db()
    ).query(
      'SELECT id,name,scopes,revoked_at,created_at FROM integration_tokens WHERE campaign_id=$1 ORDER BY created_at DESC',
      [a.campaignId],
    )
  ).rows;
}
export async function revokeIntegration(a: Actor, id: string) {
  master(a);
  await (
    await db()
  ).transaction(async (tx) => {
    const r = await one(
      'UPDATE integration_tokens SET revoked_at=now() WHERE id=$1 AND campaign_id=$2 RETURNING id',
      [id, a.campaignId],
      tx,
    );
    assert(r);
    await audit(tx, a, 'revocar-integración', id);
  });
  return { ok: true };
}
export function checkIntegration(t: Integration, method: string, p: string[]) {
  assert(p[0] === 'campaigns' && p[1] === t.campaignId, 404);
  const section = p[2];
  let scope = '';
  if (method === 'GET' && section === 'records' && p.length <= 4) scope = 'read';
  if (method === 'GET' && section === 'attachments' && p.length === 4) scope = 'files';
  if (method === 'POST' && section === 'records' && p.length === 3) scope = 'draft';
  if (method === 'PATCH' && section === 'records' && p.length === 4) scope = 'draft';
  if (method === 'POST' && section === 'folders' && p.length === 3) scope = 'folders';
  if (method === 'POST' && section === 'records' && p[4] === 'links' && p.length === 5)
    scope = 'folders';
  if (method === 'POST' && section === 'attachments' && p.length === 3) scope = 'files';
  assert(scope && t.scopes.includes(scope), 403, 'La credencial no autoriza esta operación');
}
