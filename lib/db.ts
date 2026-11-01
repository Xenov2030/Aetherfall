import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
export type Row = Record<string, any>; // SQL boundary; validated projections leave this module.
export interface DB {
  query<T extends Row = Row>(sql: string, args?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
}
let singleton: Promise<DB> | undefined;
let closeConnection: (() => Promise<void>) | undefined;
export async function closeDB() {
  if (singleton) {
    await singleton;
    await closeConnection?.();
    singleton = undefined;
  }
}
export function localMode() {
  return (
    process.env.AETHERFALL_LOCAL === '1' &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== 'production'
  );
}
export function db(): Promise<DB> {
  return (singleton ??= (async () => {
    if (localMode() && !process.env.DATABASE_URL) {
      const root = process.env.AETHERFALL_LOCAL_DIR || path.join(process.cwd(), '.local');
      await mkdir(root, { recursive: true });
      const p = new PGlite(path.join(root, 'postgres'));
      closeConnection = () => p.close();
      const wrap = (q: any): DB => ({
        query: (sql, args = []) => q.query(sql, args),
        transaction: (fn) => q.transaction((tx: any) => fn(wrap(tx))),
      });
      return wrap(p);
    }
    if (!process.env.DATABASE_URL)
      throw new Error(
        'Falta DATABASE_URL. Configurá PostgreSQL externo o el modo local de desarrollo.',
      );
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    pool.on('error', () =>
      console.error('Conexión PostgreSQL inactiva interrumpida; el pool reconectará.'),
    );
    closeConnection = () => pool.end();
    const wrap = (q: any): DB => ({
      query: (sql, args = []) => q.query(sql, args),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            query: (s, a = []) => client.query(s, a),
            transaction: async () => {
              throw new Error('Transacción anidada no permitida');
            },
          });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    });
    return wrap(pool);
  })());
}
export async function one<T extends Row = Row>(
  sql: string,
  args: unknown[] = [],
  conn?: DB,
): Promise<T | undefined> {
  return (await (conn ?? (await db())).query<T>(sql, args)).rows[0];
}
