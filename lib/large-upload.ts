import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { db, one } from './db';
import { master, readRecord, type Actor } from './policy';
import { assert } from './errors';
import { validateFile, putObject } from './storage';
import { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from './upload-limits';
import { audit } from './service';

// Created on demand so existing installations need no manual database update.
// Temporary bytes are never part of a campaign export or a visible record.
export async function startUpload(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      record_id: z.uuid(),
      fragment_id: z.uuid().nullable().optional(),
      name: z.string().min(1).max(180),
      mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain']),
      size: z.number().int().positive().max(MAX_FILE_BYTES),
    })
    .strict()
    .parse(input);
  await readRecord(a, p.record_id);
  if (p.fragment_id)
    assert(
      await one('SELECT id FROM fragments WHERE id=$1 AND record_id=$2 AND campaign_id=$3', [
        p.fragment_id,
        p.record_id,
        a.campaignId,
      ]),
    );
  const conn = await db();
  await conn.query(`CREATE TABLE IF NOT EXISTS pending_uploads (
    id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users, record_id uuid NOT NULL REFERENCES records ON DELETE CASCADE,
    fragment_id uuid, name text NOT NULL, mime text NOT NULL, size integer NOT NULL,
    data bytea NOT NULL DEFAULT ''::bytea, expires timestamptz NOT NULL DEFAULT now()+interval '1 hour'
  )`);
  return conn.transaction(async (tx) => {
    await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [a.campaignId]);
    await tx.query('DELETE FROM pending_uploads WHERE expires<now()');
    const count = await one(
      'SELECT count(*)::int AS n FROM pending_uploads WHERE user_id=$1',
      [a.userId],
      tx,
    );
    assert(count!.n < 5, 429, 'Hay cargas pendientes. Esperá una hora antes de iniciar más.');
    const id = randomUUID();
    await tx.query(
      'INSERT INTO pending_uploads(id,campaign_id,user_id,record_id,fragment_id,name,mime,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        a.campaignId,
        a.userId,
        p.record_id,
        p.fragment_id || null,
        p.name.replace(/[\x00-\x1f\x7f/\\]/g, '_'),
        p.mime,
        p.size,
      ],
    );
    return { id, chunkSize: UPLOAD_CHUNK_BYTES };
  });
}
export async function appendUpload(a: Actor, id: string, offset: number, bytes: Buffer) {
  master(a);
  assert(
    Number.isSafeInteger(offset) &&
      offset >= 0 &&
      bytes.length > 0 &&
      bytes.length <= UPLOAD_CHUNK_BYTES,
    400,
    'Parte de archivo inválida',
  );
  const r = await one(
    `UPDATE pending_uploads SET data=data || $5::bytea WHERE id=$1 AND campaign_id=$2 AND user_id=$3 AND expires>now() AND octet_length(data)=$4 AND octet_length(data)+$6<=size RETURNING octet_length(data) AS received`,
    [id, a.campaignId, a.userId, offset, bytes, bytes.length],
  );
  assert(
    r,
    409,
    'La carga venció o las partes están fuera de orden. Volvé a seleccionar el archivo.',
  );
  return r;
}
export async function cancelUpload(a: Actor, id: string) {
  master(a);
  await (
    await db()
  ).query('DELETE FROM pending_uploads WHERE id=$1 AND campaign_id=$2 AND user_id=$3', [
    id,
    a.campaignId,
    a.userId,
  ]);
  return { ok: true };
}
export async function finishUpload(a: Actor, id: string) {
  master(a);
  return (await db()).transaction(async (tx) => {
    const r = await one(
      'SELECT * FROM pending_uploads WHERE id=$1 AND campaign_id=$2 AND user_id=$3 AND expires>now() FOR UPDATE',
      [id, a.campaignId, a.userId],
      tx,
    );
    assert(r, 404, 'La carga venció. Volvé a seleccionar el archivo.');
    // Recheck the destination after receiving all bytes.
    assert(
      await one(
        'SELECT id FROM records WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL',
        [r.record_id, a.campaignId],
        tx,
      ),
    );
    if (r.fragment_id)
      assert(
        await one(
          'SELECT id FROM fragments WHERE id=$1 AND record_id=$2 AND campaign_id=$3',
          [r.fragment_id, r.record_id, a.campaignId],
          tx,
        ),
      );
    const bytes = Buffer.from(r.data);
    assert(bytes.length === r.size, 409, 'El archivo todavía no terminó de cargar');
    validateFile(bytes, r.mime);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = await one(
      'SELECT id FROM attachments WHERE record_id=$1 AND sha256=$2 AND fragment_id IS NOT DISTINCT FROM $3::uuid',
      [r.record_id, hash, r.fragment_id],
      tx,
    );
    let fileId = existing?.id;
    if (!fileId) {
      fileId = randomUUID();
      const key = await putObject(randomUUID(), bytes, r.mime, r.name);
      await tx.query(
        'INSERT INTO attachments(id,campaign_id,record_id,fragment_id,name,mime,size,object_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [fileId, a.campaignId, r.record_id, r.fragment_id, r.name, r.mime, bytes.length, key, hash],
      );
      await audit(tx, a, 'adjuntar', fileId);
    }
    await tx.query('DELETE FROM pending_uploads WHERE id=$1', [id]);
    return { id: fileId, duplicate: !!existing };
  });
}
