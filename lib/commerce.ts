import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, one, type DB } from './db';
import { assert } from './errors';
import { master, characterIds, type Actor } from './policy';
import { audit } from './service';
const money = z.string().regex(/^(0|[1-9]\d{0,14})$/, 'Usá unidades base enteras, sin decimales');
async function lockKey(tx: DB, a: Actor, key: string, operation: string) {
  const row = await one(
    'INSERT INTO operation_keys(key,campaign_id,actor_id,operation) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET key=operation_keys.key RETURNING campaign_id,actor_id,operation',
    [key, a.campaignId, a.userId, operation],
    tx,
  );
  assert(
    row &&
      row.campaign_id === a.campaignId &&
      row.actor_id === a.userId &&
      row.operation === operation,
    409,
    'La clave de operación ya fue utilizada',
  );
}
async function character(a: Actor, id: string) {
  assert((await characterIds(a)).includes(id));
}
export async function commerce(a: Actor) {
  const ids = await characterIds(a),
    conn = await db();
  const currencies = (
    await conn.query(
      'SELECT id,name,symbol,base_units::text FROM currencies WHERE campaign_id=$1 ORDER BY base_units DESC',
      [a.campaignId],
    )
  ).rows;
  const wallets = (
    await conn.query(
      'SELECT character_id,balance::text,version FROM wallets WHERE campaign_id=$1 AND character_id=ANY($2::uuid[])',
      [a.campaignId, ids],
    )
  ).rows;
  const inventory = (
    await conn.query(
      `SELECT id,character_id,name,description,quantity,source,version${a.role === 'master' ? ',private_notes' : ''} FROM inventory_items WHERE campaign_id=$1 AND character_id=ANY($2::uuid[]) AND quantity>0 ORDER BY name`,
      [a.campaignId, ids],
    )
  ).rows;
  const products =
    a.role === 'master'
      ? (
          await conn.query(
            'SELECT id,private_name,known_name,shop_name,description,private_notes,stock,base_price::text,version FROM products WHERE campaign_id=$1 ORDER BY private_name',
            [a.campaignId],
          )
        ).rows
      : (
          await conn.query(
            `SELECT p.id,p.known_name,p.shop_name,p.description,g.character_id,g.offered_price::text,CASE WHEN g.stock_visibility='exacta' THEN p.stock::text WHEN p.stock=0 THEN 'agotado' WHEN g.stock_visibility='aproximada' THEN CASE WHEN p.stock<5 THEN 'pocas unidades' ELSE 'varias unidades' END ELSE 'disponible' END AS availability FROM products p JOIN catalog_grants g ON g.product_id=p.id WHERE p.campaign_id=$1 AND g.character_id=ANY($2::uuid[]) ORDER BY p.known_name`,
            [a.campaignId, ids],
          )
        ).rows;
  const purchases = (
    await conn.query(
      `SELECT p.id,p.character_id,p.quantity,p.unit_price::text,p.state,p.created_at,pr.known_name FROM purchases p JOIN products pr ON pr.id=p.product_id WHERE p.campaign_id=$1 AND ($2='master' OR p.character_id=ANY($3::uuid[])) ORDER BY p.created_at DESC LIMIT 100`,
      [a.campaignId, a.role, ids],
    )
  ).rows;
  const movements = (
    await conn.query(
      'SELECT id,character_id,type,amount::text,quantity,created_at FROM movements WHERE campaign_id=$1 AND character_id=ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 100',
      [a.campaignId, ids],
    )
  ).rows;
  return { currencies, wallets, inventory, products, purchases, movements };
}
export async function createCurrency(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      name: z.string().trim().min(1).max(80),
      symbol: z.string().trim().min(1).max(10),
      base_units: money.refine((v) => BigInt(v) > 0n),
    })
    .parse(input);
  const id = randomUUID();
  await (
    await db()
  ).query('INSERT INTO currencies(id,campaign_id,name,symbol,base_units) VALUES($1,$2,$3,$4,$5)', [
    id,
    a.campaignId,
    p.name,
    p.symbol,
    p.base_units,
  ]);
  return { id };
}
export async function adjustWallet(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      character_id: z.uuid(),
      amount: z.string().regex(/^-?(0|[1-9]\d{0,14})$/),
      idempotency_key: z.uuid(),
    })
    .parse(input);
  await character(a, p.character_id);
  return (await db()).transaction(async (tx) => {
    await lockKey(tx, a, p.idempotency_key, 'wallet');
    const old = await one(
      'SELECT id FROM movements WHERE idempotency_key=$1 AND campaign_id=$2',
      [p.idempotency_key, a.campaignId],
      tx,
    );
    if (old) return old;
    await tx.query(
      'INSERT INTO wallets(campaign_id,character_id,balance) VALUES($1,$2,0) ON CONFLICT DO NOTHING',
      [a.campaignId, p.character_id],
    );
    const r = await one(
      'UPDATE wallets SET balance=balance+$3::bigint,version=version+1 WHERE campaign_id=$1 AND character_id=$2 AND balance+$3::bigint>=0 RETURNING balance::text',
      [a.campaignId, p.character_id, p.amount],
      tx,
    );
    assert(r, 409, 'El ajuste dejaría un saldo negativo');
    const id = randomUUID();
    await tx.query(
      "INSERT INTO movements(id,campaign_id,character_id,actor_id,type,amount,idempotency_key) VALUES($1,$2,$3,$4,'ajuste de monedas',$5,$6)",
      [id, a.campaignId, p.character_id, a.userId, p.amount, p.idempotency_key],
    );
    await audit(tx, a, 'ajustar-monedas', id);
    return r;
  });
}
export async function createProduct(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      private_name: z.string().min(1).max(180),
      known_name: z.string().min(1).max(180),
      shop_name: z.string().min(1).max(180),
      description: z.string().max(20000).default(''),
      private_notes: z.string().max(20000).default(''),
      stock: z.number().int().min(0).max(1000000),
      base_price: money,
    })
    .parse(input);
  const id = randomUUID();
  await (
    await db()
  ).query(
    'INSERT INTO products(id,campaign_id,private_name,known_name,shop_name,description,private_notes,stock,base_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      id,
      a.campaignId,
      p.private_name,
      p.known_name,
      p.shop_name,
      p.description,
      p.private_notes,
      p.stock,
      p.base_price,
    ],
  );
  return { id };
}
export async function revealProduct(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z
    .object({
      characters: z.array(z.uuid()).min(1).max(100),
      offered_price: money,
      stock_visibility: z.enum(['exacta', 'aproximada', 'disponible']),
      revoke: z.boolean().default(false),
    })
    .parse(input);
  assert(await one('SELECT id FROM products WHERE id=$1 AND campaign_id=$2', [id, a.campaignId]));
  for (const c of p.characters) await character(a, c);
  await (
    await db()
  ).transaction(async (tx) => {
    for (const c of new Set(p.characters)) {
      if (p.revoke)
        await tx.query('DELETE FROM catalog_grants WHERE product_id=$1 AND character_id=$2', [
          id,
          c,
        ]);
      else
        await tx.query(
          'INSERT INTO catalog_grants(campaign_id,product_id,character_id,offered_price,stock_visibility) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id,character_id) DO UPDATE SET offered_price=excluded.offered_price,stock_visibility=excluded.stock_visibility',
          [a.campaignId, id, c, p.offered_price, p.stock_visibility],
        );
    }
    await audit(tx, a, p.revoke ? 'retirar-producto' : 'revelar-producto', id, {
      characters: p.characters,
    });
  });
  return { ok: true };
}
export async function requestPurchase(a: Actor, input: unknown) {
  const p = z
    .object({
      character_id: z.uuid(),
      product_id: z.uuid(),
      quantity: z.number().int().min(1).max(1000),
      idempotency_key: z.uuid(),
    })
    .parse(input);
  await character(a, p.character_id);
  return (await db()).transaction(async (tx) => {
    await lockKey(tx, a, p.idempotency_key, 'purchase');
    const prior = await one(
      'SELECT id,state FROM purchases WHERE idempotency_key=$1 AND campaign_id=$2 AND requested_by=$3',
      [p.idempotency_key, a.campaignId, a.userId],
      tx,
    );
    if (prior) return prior;
    const grant = await one(
      'SELECT offered_price::text FROM catalog_grants WHERE product_id=$1 AND character_id=$2 AND campaign_id=$3',
      [p.product_id, p.character_id, a.campaignId],
      tx,
    );
    assert(grant);
    const id = randomUUID();
    await tx.query(
      "INSERT INTO purchases(id,campaign_id,character_id,product_id,requested_by,quantity,unit_price,state,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,'pendiente',$8)",
      [
        id,
        a.campaignId,
        p.character_id,
        p.product_id,
        a.userId,
        p.quantity,
        grant.offered_price,
        p.idempotency_key,
      ],
    );
    return { id, state: 'pendiente' };
  });
}
export async function confirmPurchase(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z
    .object({ unit_price: money.optional(), reject: z.boolean().default(false) })
    .parse(input);
  return (await db()).transaction(async (tx) => {
    const purchase = await one(
      'SELECT *,unit_price::text AS price FROM purchases WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
      [id, a.campaignId],
      tx,
    );
    assert(purchase);
    if (purchase.state !== 'pendiente') return { state: purchase.state, duplicate: true };
    if (p.reject) {
      await tx.query("UPDATE purchases SET state='rechazada' WHERE id=$1", [id]);
      await audit(tx, a, 'rechazar-compra', id);
      return { state: 'rechazada' };
    }
    assert(
      await one(
        'SELECT product_id FROM catalog_grants WHERE product_id=$1 AND character_id=$2 AND campaign_id=$3',
        [purchase.product_id, purchase.character_id, a.campaignId],
        tx,
      ),
      409,
      'El producto ya no está autorizado',
    );
    const price = p.unit_price ?? purchase.price,
      total = (BigInt(price) * BigInt(purchase.quantity)).toString();
    const product = await one(
      'UPDATE products SET stock=stock-$3,version=version+1 WHERE id=$1 AND campaign_id=$2 AND stock>=$3 RETURNING known_name,description',
      [purchase.product_id, a.campaignId, purchase.quantity],
      tx,
    );
    assert(product, 409, 'No hay existencias suficientes');
    const wallet = await one(
      'UPDATE wallets SET balance=balance-$3::bigint,version=version+1 WHERE character_id=$1 AND campaign_id=$2 AND balance>=$3::bigint RETURNING character_id',
      [purchase.character_id, a.campaignId, total],
      tx,
    );
    assert(wallet, 409, 'No hay monedas suficientes');
    const itemId = randomUUID();
    await tx.query(
      "INSERT INTO inventory_items(id,campaign_id,character_id,name,description,quantity,source) VALUES($1,$2,$3,$4,$5,$6,'compra confirmada')",
      [
        itemId,
        a.campaignId,
        purchase.character_id,
        product.known_name,
        product.description,
        purchase.quantity,
      ],
    );
    await tx.query(
      "INSERT INTO movements(id,campaign_id,character_id,actor_id,type,amount,item_id,quantity,idempotency_key) VALUES($1,$2,$3,$4,'compra',$5,$6,$7,$8)",
      [
        randomUUID(),
        a.campaignId,
        purchase.character_id,
        a.userId,
        (-BigInt(total)).toString(),
        itemId,
        purchase.quantity,
        purchase.idempotency_key,
      ],
    );
    await tx.query("UPDATE purchases SET state='confirmada',unit_price=$2 WHERE id=$1", [
      id,
      price,
    ]);
    await audit(tx, a, 'confirmar-compra', id);
    return { state: 'confirmada', item_id: itemId };
  });
}
export async function deliverItem(a: Actor, input: unknown) {
  master(a);
  const p = z
    .object({
      character_id: z.uuid(),
      name: z.string().min(1).max(180),
      description: z.string().max(20000).default(''),
      private_notes: z.string().max(20000).default(''),
      quantity: z.number().int().min(1).max(1000000),
      idempotency_key: z.uuid(),
    })
    .parse(input);
  await character(a, p.character_id);
  return (await db()).transaction(async (tx) => {
    await lockKey(tx, a, p.idempotency_key, 'item');
    const prior = await one(
      'SELECT item_id FROM movements WHERE idempotency_key=$1 AND campaign_id=$2',
      [p.idempotency_key, a.campaignId],
      tx,
    );
    if (prior) return prior;
    const id = randomUUID();
    await tx.query(
      "INSERT INTO inventory_items(id,campaign_id,character_id,name,description,private_notes,quantity,source) VALUES($1,$2,$3,$4,$5,$6,$7,'entrega del máster')",
      [id, a.campaignId, p.character_id, p.name, p.description, p.private_notes, p.quantity],
    );
    await tx.query(
      "INSERT INTO movements(id,campaign_id,character_id,actor_id,type,item_id,quantity,idempotency_key) VALUES($1,$2,$3,$4,'entrega',$5,$6,$7)",
      [randomUUID(), a.campaignId, p.character_id, a.userId, id, p.quantity, p.idempotency_key],
    );
    await audit(tx, a, 'entregar-objeto', id);
    return { id };
  });
}
export async function transferItem(a: Actor, id: string, input: unknown) {
  master(a);
  const p = z
    .object({
      to_character_id: z.uuid().optional(),
      quantity: z.number().int().min(1).max(1000000),
      idempotency_key: z.uuid(),
    })
    .parse(input);
  if (p.to_character_id) await character(a, p.to_character_id);
  return (await db()).transaction(async (tx) => {
    await lockKey(tx, a, p.idempotency_key, 'item');
    const prior = await one(
      'SELECT item_id FROM movements WHERE idempotency_key=$1 AND campaign_id=$2',
      [p.idempotency_key, a.campaignId],
      tx,
    );
    if (prior) return prior;
    const item = await one(
      'UPDATE inventory_items SET quantity=quantity-$3,version=version+1 WHERE id=$1 AND campaign_id=$2 AND quantity>=$3 RETURNING *',
      [id, a.campaignId, p.quantity],
      tx,
    );
    assert(item, 409, 'Cantidad no disponible');
    let target: string | undefined;
    if (p.to_character_id) {
      target = randomUUID();
      await tx.query(
        'INSERT INTO inventory_items(id,campaign_id,character_id,name,description,quantity,source) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          target,
          a.campaignId,
          p.to_character_id,
          item.name,
          item.description,
          p.quantity,
          'transferencia confirmada',
        ],
      );
    }
    await tx.query(
      'INSERT INTO movements(id,campaign_id,character_id,actor_id,type,item_id,quantity,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        randomUUID(),
        a.campaignId,
        item.character_id,
        a.userId,
        target ? 'transferencia' : 'consumo',
        id,
        -p.quantity,
        p.idempotency_key,
      ],
    );
    await audit(tx, a, target ? 'transferir-objeto' : 'consumir-objeto', id);
    return { ok: true, target };
  });
}
