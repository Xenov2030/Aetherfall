import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, one } from './db';
import { assert } from './errors';
import { master, characterIds, type Actor } from './policy';
import { audit } from './service';
const journalInput = z.object({
  character_id: z.uuid(),
  type: z.enum(['bitácora', 'momento', 'intención']),
  title: z.string().trim().min(1).max(180),
  body: z.string().max(20000),
  significance: z.string().max(5000).default(''),
  change_text: z.string().max(5000).default(''),
  explore: z.string().max(5000).default(''),
});
export async function journals(a: Actor): Promise<Record<string, any>[]> {
  const ids = await characterIds(a);
  const rows = (
    await (
      await db()
    ).query(
      `SELECT DISTINCT j.* FROM journals j LEFT JOIN journal_recipients jr ON jr.journal_id=j.id WHERE j.campaign_id=$1 AND j.deleted_at IS NULL AND (($2='master' AND j.shared_master=true) OR ($4=false AND j.author_id=$3) OR jr.character_id=ANY($5::uuid[])) ORDER BY j.created_at DESC`,
      [a.campaignId, a.role, a.userId, !!a.preview, ids],
    )
  ).rows;
  return Promise.all(
    rows.map(async (j) => ({
      ...j,
      can_edit: j.author_id === a.userId && !a.preview,
      recipients:
        j.author_id === a.userId
          ? (
              await (
                await db()
              ).query('SELECT character_id FROM journal_recipients WHERE journal_id=$1', [j.id])
            ).rows.map((r) => r.character_id)
          : [],
    })),
  );
}
export async function createJournal(a: Actor, input: unknown) {
  const p = journalInput.parse(input);
  assert((await characterIds(a)).includes(p.character_id), 403, 'Ese personaje no te pertenece');
  const id = randomUUID();
  await (
    await db()
  ).query(
    'INSERT INTO journals(id,campaign_id,character_id,author_id,type,title,body,significance,change_text,explore) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      id,
      a.campaignId,
      p.character_id,
      a.userId,
      p.type,
      p.title,
      p.body,
      p.significance,
      p.change_text,
      p.explore,
    ],
  );
  return { id };
}
export async function editJournal(a: Actor, id: string, input: unknown) {
  const p = z
    .object({
      version: z.number().int().positive(),
      title: z.string().trim().min(1).max(180),
      body: z.string().max(20000),
      shared_master: z.boolean(),
      recipients: z.array(z.uuid()).max(100).default([]),
    })
    .parse(input);
  return (await db()).transaction(async (tx) => {
    const j = await one(
      'SELECT * FROM journals WHERE id=$1 AND campaign_id=$2 AND author_id=$3 AND deleted_at IS NULL FOR UPDATE',
      [id, a.campaignId, a.userId],
      tx,
    );
    assert(j);
    assert(j.version === p.version, 409, 'La bitácora cambió. Actualizá antes de guardar.');
    const allowed = (
      await tx.query(
        "SELECT id FROM records WHERE campaign_id=$1 AND kind='character' AND deleted_at IS NULL",
        [a.campaignId],
      )
    ).rows.map((r) => r.id);
    for (const c of p.recipients) assert(allowed.includes(c));
    await tx.query(
      'UPDATE journals SET title=$2,body=$3,shared_master=$4,version=version+1,updated_at=now() WHERE id=$1',
      [id, p.title, p.body, p.shared_master],
    );
    await tx.query('DELETE FROM journal_recipients WHERE journal_id=$1', [id]);
    for (const c of new Set(p.recipients))
      await tx.query(
        'INSERT INTO journal_recipients(campaign_id,journal_id,character_id) VALUES($1,$2,$3)',
        [a.campaignId, id, c],
      );
    return { ok: true };
  });
}
export async function threads(a: Actor) {
  const ids = await characterIds(a);
  if (a.role === 'master')
    return (
      await (
        await db()
      ).query('SELECT * FROM threads WHERE campaign_id=$1 ORDER BY created_at DESC', [a.campaignId])
    ).rows;
  return (
    await (
      await db()
    ).query(
      'SELECT id,title,visible_sender,replies_enabled,sent_at,character_id FROM threads WHERE campaign_id=$1 AND character_id=ANY($2::uuid[]) AND sent_at IS NOT NULL ORDER BY sent_at DESC',
      [a.campaignId, ids],
    )
  ).rows;
}
export async function threadDetail(a: Actor, id: string): Promise<Record<string, any>> {
  const t = (await threads(a)).find((r) => r.id === id);
  assert(t);
  const messages = (
    await (
      await db()
    ).query(
      'SELECT id,body,from_master,opened_at,created_at FROM thread_messages WHERE thread_id=$1 AND campaign_id=$2 ORDER BY created_at',
      [id, a.campaignId],
    )
  ).rows;
  if (a.role === 'player' && !a.preview)
    await (
      await db()
    ).query(
      'UPDATE thread_messages SET opened_at=COALESCE(opened_at,now()) WHERE thread_id=$1 AND from_master=true',
      [id],
    );
  return { ...t, messages };
}
export async function createThread(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      character_id: z.uuid(),
      title: z.string().trim().min(1).max(180),
      visible_sender: z.string().trim().min(1).max(180),
      real_sender: z.string().max(5000).default(''),
      body: z.string().min(1).max(20000),
      replies_enabled: z.boolean().default(false),
      send: z.boolean().default(false),
    })
    .parse(input);
  assert((await characterIds(a)).includes(p.character_id));
  const id = randomUUID();
  await (
    await db()
  ).transaction(async (tx) => {
    await tx.query(
      'INSERT INTO threads(id,campaign_id,character_id,title,visible_sender,real_sender,replies_enabled,sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8 THEN now() ELSE NULL END)',
      [
        id,
        a.campaignId,
        p.character_id,
        p.title,
        p.visible_sender,
        p.real_sender,
        p.replies_enabled,
        p.send,
      ],
    );
    await tx.query(
      'INSERT INTO thread_messages(id,campaign_id,thread_id,author_id,from_master,body) VALUES($1,$2,$3,$4,true,$5)',
      [randomUUID(), a.campaignId, id, a.userId, p.body],
    );
    await audit(tx, a, p.send ? 'enviar-correspondencia' : 'borrador-correspondencia', id);
  });
  return { id };
}
export async function sendThread(a: Actor, id: string) {
  master(a);
  await (
    await db()
  ).transaction(async (tx) => {
    const t = await one(
      'UPDATE threads SET sent_at=COALESCE(sent_at,now()) WHERE id=$1 AND campaign_id=$2 RETURNING id',
      [id, a.campaignId],
      tx,
    );
    assert(t);
    await audit(tx, a, 'enviar-correspondencia', id);
  });
  return { ok: true };
}
export async function replyThread(a: Actor, id: string, input: unknown) {
  const p = z.object({ body: z.string().min(1).max(20000) }).parse(input);
  const t = await threadDetail(a, id);
  assert(a.role === 'master' || t.replies_enabled, 403, 'Las respuestas están deshabilitadas');
  assert(t.sent_at, 400, 'Enviá el borrador antes de continuar la conversación');
  await (
    await db()
  ).transaction(async (tx) => {
    await tx.query(
      'INSERT INTO thread_messages(id,campaign_id,thread_id,author_id,from_master,body) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), a.campaignId, id, a.userId, a.role === 'master', p.body],
    );
    await audit(tx, a, 'responder-correspondencia', id);
  });
  return { ok: true };
}
