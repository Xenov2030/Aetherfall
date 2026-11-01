import { db, type DB } from './db';
import { master, type Actor } from './policy';
import { assert } from './errors';
import { readObject, putObject, validateFile } from './storage';
import { createHash, randomUUID } from 'node:crypto';
const tables = [
  'campaigns',
  'members',
  'invitations',
  'folders',
  'records',
  'fragments',
  'grants',
  'attachments',
  'record_links',
  'revisions',
  'audit',
  'journals',
  'journal_recipients',
  'threads',
  'thread_messages',
  'currencies',
  'wallets',
  'products',
  'catalog_grants',
  'purchases',
  'inventory_items',
  'movements',
  'operation_keys',
] as const;
export async function exportCampaign(a: Actor, options: { operator?: boolean } = {}) {
  master(a);
  const data: Record<string, unknown> = {};
  await (
    await db()
  ).transaction(async (tx) => {
    for (const table of tables) {
      let restriction = '';
      const args: unknown[] = [a.campaignId];
      if (!options.operator && table === 'journals') {
        restriction = ' AND (shared_master=true OR author_id=$2)';
        args.push(a.userId);
      }
      if (!options.operator && table === 'journal_recipients') {
        restriction =
          ' AND journal_id IN (SELECT id FROM journals WHERE campaign_id=$1 AND (shared_master=true OR author_id=$2))';
        args.push(a.userId);
      }
      if (!options.operator && table === 'records') {
        restriction = " AND (kind<>'roll' OR owner_id=$2)";
        args.push(a.userId);
      }
      data[table] = (
        await tx.query(
          `SELECT * FROM ${table} WHERE ${table === 'campaigns' ? 'id' : 'campaign_id'}=$1${restriction}`,
          args,
        )
      ).rows;
    }
    data.users = (
      await tx.query(
        'SELECT id,email,name,email_verified,image FROM users WHERE id IN (SELECT user_id FROM members WHERE campaign_id=$1)',
        [a.campaignId],
      )
    ).rows;
  });
  const files = [];
  for (const f of data.attachments as any[]) {
    const body = await readObject(f.object_key);
    assert(
      createHash('sha256').update(body).digest('hex') === f.sha256,
      500,
      'Un archivo no supera la comprobación de integridad',
    );
    files.push({ key: f.object_key, body: body.toString('base64') });
  }
  return { format: 'aetherfall-1', exported_at: new Date().toISOString(), data, files };
}
export async function restoreBackup(input: any) {
  assert(
    input?.format === 'aetherfall-1' && input?.data?.campaigns?.length === 1,
    400,
    'Formato de respaldo inválido',
  );
  const id = input.data.campaigns[0].id;
  for (const table of tables) {
    for (const row of input.data[table] ?? []) {
      assert(
        (table === 'campaigns' ? row.id : row.campaign_id) === id,
        400,
        'El respaldo contiene datos de otra campaña',
      );
    }
  }
  assert(
    !(await (await db()).query('SELECT id FROM campaigns WHERE id=$1', [id])).rows.length,
    409,
    'Restaurar requiere una base sin esta campaña',
  );
  const files = new Map<string, Buffer>();
  for (const f of input.files ?? []) {
    assert(
      /^(s3:)?[a-f0-9-]{36}$/.test(f.key) || /^drive:[A-Za-z0-9_-]{10,200}$/.test(f.key),
      400,
      'Clave de archivo inválida',
    );
    assert(!files.has(f.key), 400, 'Archivo duplicado');
    files.set(f.key, Buffer.from(f.body, 'base64'));
  }
  for (const f of input.data.attachments ?? []) {
    const b = files.get(f.object_key);
    assert(b, 400, 'Falta un archivo');
    validateFile(b, f.mime);
    assert(
      b.length === f.size && createHash('sha256').update(b).digest('hex') === f.sha256,
      400,
      'Archivo corrupto',
    );
  }
  // Objects are immutable UUID keys. Upload before committing references; failure leaves at most an orphan, never a broken committed reference.
  const restoredReferences = new Map<string, string>();
  for (const f of input.data.attachments ?? []) {
    const old = f.object_key;
    const reference =
      restoredReferences.get(old) ??
      (await putObject(
        old.startsWith('drive:') ? randomUUID() : old.replace(/^s3:/, ''),
        files.get(old)!,
        f.mime,
        f.name,
      ));
    restoredReferences.set(old, reference);
  }
  // Never mutate the caller's backup; the destination Drive creates new file IDs.
  input = {
    ...input,
    data: {
      ...input.data,
      attachments: (input.data.attachments ?? []).map((f: any) => ({
        ...f,
        object_key: restoredReferences.get(f.object_key),
      })),
    },
  };
  await (
    await db()
  ).transaction(async (tx) => {
    const insert = async (table: string, rows: any[]) => {
      for (const row of rows) {
        const keys = Object.keys(row);
        assert(
          keys.every((k) => /^[a-z_][a-z0-9_]*$/.test(k)),
          400,
          'Columnas inválidas',
        );
        const vals = keys.map((k) =>
          row[k] && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k],
        );
        await tx.query(
          `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})${table === 'users' ? ' ON CONFLICT(id) DO NOTHING' : ''}`,
          vals,
        );
      }
    };
    await insert('users', input.data.users ?? []);
    for (const table of tables) {
      let rows = input.data[table] ?? [];
      if (table === 'folders') {
        const ordered: any[] = [];
        const pending = [...rows];
        while (pending.length) {
          const i = pending.findIndex(
            (r) => !r.parent_id || ordered.some((p) => p.id === r.parent_id),
          );
          assert(i >= 0, 400, 'Jerarquía de carpetas inválida');
          ordered.push(...pending.splice(i, 1));
        }
        rows = ordered;
      }
      await insert(table, rows);
    }
  });
  return id;
}
