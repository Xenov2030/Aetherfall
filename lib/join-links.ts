import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, one } from './db';
import { assert } from './errors';
import { master, type Actor } from './policy';

function signature(campaign: string, id: string) {
  assert(process.env.NEXTAUTH_SECRET, 503, 'El acceso no está configurado');
  return createHmac('sha256', process.env.NEXTAUTH_SECRET)
    .update(`join-player:${campaign}:${id}`)
    .digest('hex');
}
// Audit stores link generations without adding a production schema migration.
export async function joinLink(a: Actor, renew = false) {
  master(a);
  return (await db()).transaction(async (tx) => {
    await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [a.campaignId]);
    let row = await one(
      "SELECT id,details FROM audit WHERE campaign_id=$1 AND action='enlace-jugadores' ORDER BY created_at DESC,id DESC LIMIT 1",
      [a.campaignId],
      tx,
    );
    if (!row || renew || Number(row.details.expires) <= Date.now()) {
      row = { id: randomUUID(), details: { expires: Date.now() + 30 * 86400000 } };
      await tx.query(
        "INSERT INTO audit(id,campaign_id,actor_id,action,details) VALUES($1,$2,$3,'enlace-jugadores',$4)",
        [row.id, a.campaignId, a.userId, JSON.stringify(row.details)],
      );
    }
    return {
      path: `/login?campana=${a.campaignId}&invitacion=${row.id}.${signature(a.campaignId, row.id)}`,
      expires: row.details.expires,
    };
  });
}
export async function registerFromLink(input: unknown) {
  const p = z
    .object({
      campaign: z.uuid(),
      token: z.string().max(150),
      email: z
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
    })
    .strict()
    .parse(input);
  const [id, sig, extra] = p.token.split('.');
  assert(
    z.uuid().safeParse(id).success && sig?.length === 64 && !extra,
    403,
    'El enlace de invitación no es válido',
  );
  const expected = signature(p.campaign, id);
  assert(
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)),
    403,
    'El enlace de invitación no es válido',
  );
  await (
    await db()
  ).transaction(async (tx) => {
    await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [p.campaign]);
    const link = await one(
      "SELECT id,details FROM audit WHERE campaign_id=$1 AND action='enlace-jugadores' ORDER BY created_at DESC,id DESC LIMIT 1",
      [p.campaign],
      tx,
    );
    assert(
      link?.id === id && Number(link.details.expires) > Date.now(),
      403,
      'El enlace venció o fue reemplazado. Pedile uno nuevo al máster.',
    );
    const member = await one(
      'SELECT m.active FROM members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=$1 AND u.email=$2',
      [p.campaign, p.email],
      tx,
    );
    assert(!member || member.active, 403, 'Tu acceso está suspendido. Consultá al máster.');
    if (member) return;
    // No membership is granted until Auth.js verifies ownership of the email.
    // Keep an existing explicit invitation (including its authorized role).
    await tx.query(
      `INSERT INTO invitations(id,campaign_id,email,role,expires) VALUES($1,$2,$3,'player',now()+interval '30 minutes') ON CONFLICT(campaign_id,email) DO UPDATE SET role=CASE WHEN invitations.accepted_at IS NULL AND invitations.expires>now() THEN invitations.role ELSE 'player' END,expires=GREATEST(invitations.expires,excluded.expires),accepted_at=NULL`,
      [randomUUID(), p.campaign, p.email],
    );
  });
}
