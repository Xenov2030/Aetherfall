'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney, toBaseMoney, type Currency } from '@/lib/currency';
import { Plus, Coins, Package, Store, Eye, Check, X, ArrowRightLeft } from 'lucide-react';
type R = Record<string, any>;
type Props = {
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (a: () => Promise<unknown>, m?: string) => Promise<boolean>;
  characters: R[];
  master: boolean;
  readOnly: boolean;
};
export default function CommercePanel({ request, run, characters, master, readOnly }: Props) {
  const [data, setData] = useState<R | null>(null),
    [error, setError] = useState(''),
    [section, setSection] = useState('inventory'),
    [form, setForm] = useState(''),
    [selected, setSelected] = useState<R | null>(null);
  const load = useCallback(
    () =>
      request('/commerce')
        .then(setData)
        .catch((e) => setError(e.message)),
    [request],
  );
  useEffect(() => {
    load();
  }, [load]);
  const save = async (path: string, p: R, message = 'Movimiento registrado') => {
    if (await run(() => request(`/commerce/${path}`, 'POST', p), message)) {
      setForm('');
      setSelected(null);
      load();
    }
  };
  return (
    <>
      <div className="commerce-tabs">
        {[
          ['inventory', 'Inventario', Package],
          ['catalog', 'Mercaderes', Store],
          ['purchases', 'Solicitudes', Check],
          ['movements', 'Historial', ArrowRightLeft],
        ].map(([key, label, Icon]: any) => (
          <button
            className={`button ${section === key ? 'selected' : ''}`}
            key={key}
            onClick={() => setSection(key)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="wallet-strip">
            {characters.map((c) => (
              <div className="wallet" key={c.id}>
                <Coins size={20} />
                <div>
                  <strong>{c.title}</strong>
                  <small>
                    {formatMoney(
                      data.wallets.find((w: R) => w.character_id === c.id)?.balance ?? '0',
                      data.currencies,
                    )}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <p className="muted">
            Monedas:{' '}
            {data.currencies.length
              ? data.currencies
                  .map(
                    (c: R) =>
                      `${c.name} (${c.symbol}) = ${c.base_units} ${data.currencies.find((v: R) => v.base_units === '1')?.symbol || 'unidades base'}`,
                  )
                  .join(' · ')
              : 'sin denominaciones configuradas. No se presupone ninguna conversión.'}
          </p>
          {master && (
            <div className="commerce-actions">
              <button className="button" onClick={() => setForm('currency')}>
                Definir moneda
              </button>
              <button className="button" onClick={() => setForm('wallet')}>
                Ajustar monedas
              </button>
              <button className="button" onClick={() => setForm('delivery')}>
                Entregar objeto
              </button>
              <button className="button primary" onClick={() => setForm('product')}>
                <Plus size={15} />
                Producto privado
              </button>
            </div>
          )}
          {form && (
            <CommerceForm
              currencies={data.currencies}
              kind={form}
              selected={selected}
              characters={characters}
              close={() => {
                setForm('');
                setSelected(null);
              }}
              save={save}
            />
          )}
          <section className="panel padded">
            {section === 'inventory' ? (
              <>
                <h2>Objetos en custodia</h2>
                <p className="muted">
                  Poseer un objeto no revela sus propiedades secretas. Las notas privadas del máster
                  se conservan por separado.
                </p>
                {data.inventory.map((item: R) => (
                  <article className="inventory-card" key={item.id}>
                    <div>
                      <h3>{item.name}</h3>
                      <p className="preserve">{item.description}</p>
                      <small>
                        {characters.find((c) => c.id === item.character_id)?.title} · {item.source}
                      </small>
                      {master && item.private_notes && (
                        <p className="notice">Privado: {item.private_notes}</p>
                      )}
                    </div>
                    <span className="quantity">×{item.quantity}</span>
                    {master && (
                      <button
                        className="button"
                        onClick={() => {
                          setSelected(item);
                          setForm('transfer');
                        }}
                      >
                        Transferir / consumir
                      </button>
                    )}
                  </article>
                ))}
                {!data.inventory.length && (
                  <p className="empty">
                    No hay objetos registrados. La hoja de papel sigue siendo válida.
                  </p>
                )}
              </>
            ) : section === 'catalog' ? (
              <>
                <h2>
                  {master ? 'Inventario privado de mercaderes' : 'Productos que te mostraron'}
                </h2>
                {data.products.map((p: R) => (
                  <article className="product-card" key={`${p.id}-${p.character_id ?? ''}`}>
                    <small>{p.shop_name}</small>
                    <h3>{master ? p.private_name : p.known_name}</h3>
                    <p>{p.description}</p>
                    {master && p.private_notes && (
                      <p className="notice">Privado: {p.private_notes}</p>
                    )}
                    <div className="product-meta">
                      <span>
                        {formatMoney(master ? p.base_price : p.offered_price, data.currencies)}
                      </span>
                      <span>{master ? `${p.stock} en stock` : p.availability}</span>
                    </div>
                    {master ? (
                      <button
                        className="button"
                        onClick={() => {
                          setSelected(p);
                          setForm('catalog');
                        }}
                      >
                        <Eye size={15} />
                        Revelar / retirar catálogo
                      </button>
                    ) : (
                      <button
                        disabled={readOnly}
                        className="button primary"
                        onClick={() => {
                          setSelected(p);
                          setForm('purchase');
                        }}
                      >
                        Solicitar compra
                      </button>
                    )}
                  </article>
                ))}
                {!data.products.length && (
                  <p className="empty">No hay productos disponibles para esta vista.</p>
                )}
              </>
            ) : section === 'purchases' ? (
              <>
                <h2>Solicitudes de compra</h2>
                <p className="muted">
                  Una solicitud no descuenta dinero ni entrega objetos. El máster confirma precio,
                  saldo y existencias en una transacción.
                </p>
                {data.purchases.map((p: R) => (
                  <article className="purchase-row" key={p.id}>
                    <div>
                      <strong>
                        {p.known_name} ×{p.quantity}
                      </strong>
                      <small>
                        {characters.find((c) => c.id === p.character_id)?.title} ·{' '}
                        {formatMoney(p.unit_price, data.currencies)} por objeto
                      </small>
                    </div>
                    <span className="tag">{p.state}</span>
                    {master && p.state === 'pendiente' && (
                      <>
                        <button
                          className="button primary"
                          onClick={() => {
                            setSelected(p);
                            setForm('confirm');
                          }}
                        >
                          Revisar y confirmar
                        </button>
                        <button
                          className="button danger"
                          onClick={() =>
                            save(`purchases/${p.id}`, { reject: true }, 'Compra rechazada')
                          }
                        >
                          Rechazar
                        </button>
                      </>
                    )}
                  </article>
                ))}
                {!data.purchases.length && <p className="empty">No hay solicitudes de compra.</p>}
              </>
            ) : (
              <>
                <h2>Historial de movimientos</h2>
                {data.movements.map((m: R) => (
                  <div className="revision" key={m.id}>
                    <span>
                      <strong>{m.type}</strong>
                      <small>
                        {characters.find((c) => c.id === m.character_id)?.title} ·{' '}
                        {new Date(m.created_at).toLocaleDateString('es-AR')}
                      </small>
                    </span>
                    <span>
                      {m.amount !== '0'
                        ? formatMoney(m.amount, data.currencies)
                        : m.quantity
                          ? `${m.quantity} objetos`
                          : ''}
                    </span>
                  </div>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
function CommerceForm({
  currencies,
  kind,
  selected,
  characters,
  close,
  save,
}: {
  currencies: Currency[];
  kind: string;
  selected: R | null;
  characters: R[];
  close: () => void;
  save: (path: string, p: R, message?: string) => Promise<void>;
}) {
  const [moneyError, setMoneyError] = useState('');
  const [denominations, setDenominations] = useState<Record<string, string>>({});
  const [p, setP] = useState<R>({
      character_id: selected?.character_id ?? characters[0]?.id ?? '',
      name: '',
      description: '',
      quantity: 1,
      amount: '0',
      base_units: '1',
      symbol: '',
      private_name: '',
      known_name: '',
      shop_name: '',
      private_notes: '',
      stock: 0,
      base_price: '0',
      offered_price: selected?.base_price ?? '0',
      stock_visibility: 'disponible',
      unit_price: selected?.unit_price ?? '0',
      to_character_id: '',
      characters: [],
    }),
    [key] = useState(() => crypto.randomUUID()),
    [working, setWorking] = useState(false);
  const set = (k: string, v: any) => setP((s) => ({ ...s, [k]: v }));
  const titles: R = {
    currency: 'Definir una moneda',
    wallet: 'Ajustar saldo',
    delivery: 'Entregar un objeto',
    product: 'Crear producto privado',
    catalog: 'Elegir visibilidad y destinatarios',
    purchase: 'Solicitar una compra',
    confirm: 'Confirmar compra',
    transfer: 'Transferir o consumir',
  };
  const text = (k: string, label: string, type = 'text') => (
    <label key={k}>
      {label}
      <input
        type={type}
        value={p[k]}
        onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)}
        required={k !== 'private_notes' && k !== 'description'}
        maxLength={type === 'text' ? 20000 : undefined}
        min={type === 'number' ? 0 : undefined}
      />
    </label>
  );
  const selectedUnits = (key: string) => denominations[key] || '1';
  const moneyInput = (key: string, label: string) => (
    <div className="form-grid">
      {text(key, label)}
      <label>
        Moneda para {label.toLowerCase()}
        <select
          aria-label={`Moneda para ${label.toLowerCase()}`}
          value={selectedUnits(key)}
          onChange={(e) => setDenominations((s) => ({ ...s, [key]: e.target.value }))}
        >
          {!currencies.some((c) => c.base_units === '1') && <option value="1">Unidad base</option>}
          {currencies.map((c) => (
            <option key={c.symbol} value={c.base_units}>
              {c.name} ({c.symbol})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  const converted = (key: string) => toBaseMoney(p[key], selectedUnits(key));
  async function submit(revoke = false) {
    setWorking(true);
    setMoneyError('');
    try {
      if (kind === 'currency')
        await save('currencies', { name: p.name, symbol: p.symbol, base_units: p.base_units });
      if (kind === 'wallet')
        await save('wallets', {
          character_id: p.character_id,
          amount: converted('amount'),
          idempotency_key: key,
        });
      if (kind === 'delivery')
        await save('inventory', {
          character_id: p.character_id,
          name: p.name,
          description: p.description,
          private_notes: p.private_notes,
          quantity: p.quantity,
          idempotency_key: key,
        });
      if (kind === 'product')
        await save('products', {
          private_name: p.private_name,
          known_name: p.known_name,
          shop_name: p.shop_name,
          description: p.description,
          private_notes: p.private_notes,
          stock: p.stock,
          base_price: converted('base_price'),
        });
      if (kind === 'catalog')
        await save(
          `catalog/${selected!.id}`,
          {
            characters: p.characters,
            offered_price: converted('offered_price'),
            stock_visibility: p.stock_visibility,
            revoke,
          },
          revoke
            ? 'Producto retirado de los destinatarios'
            : 'Productos revelados de forma explícita',
        );
      if (kind === 'purchase')
        await save(
          'purchases',
          {
            character_id: selected!.character_id,
            product_id: selected!.id,
            quantity: p.quantity,
            idempotency_key: key,
          },
          'Solicitud enviada al máster',
        );
      if (kind === 'confirm')
        await save(
          `purchases/${selected!.id}`,
          { unit_price: converted('unit_price') },
          'Compra confirmada: monedas, existencias y entrega registradas',
        );
      if (kind === 'transfer')
        await save(
          `inventory/${selected!.id}`,
          {
            to_character_id: p.to_character_id || undefined,
            quantity: p.quantity,
            idempotency_key: key,
          },
          p.to_character_id ? 'Transferencia registrada' : 'Consumo registrado',
        );
    } catch (error) {
      setMoneyError(error instanceof Error ? error.message : 'Revisá el importe');
    } finally {
      setWorking(false);
    }
  }
  return (
    <form
      className="panel padded spaced"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {moneyError && (
        <p className="error" role="alert">
          {moneyError}
        </p>
      )}
      <div className="section-title compact">
        <h2>{titles[kind]}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Cerrar formulario"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      {['wallet', 'delivery'].includes(kind) && (
        <label>
          Personaje
          <select
            aria-label="Personaje"
            value={p.character_id}
            onChange={(e) => set('character_id', e.target.value)}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'currency' && (
        <>
          {text('name', 'Nombre de moneda')}
          {text('symbol', 'Símbolo')}
          {text('base_units', 'Equivalencia entera en unidades base')}
        </>
      )}
      {kind === 'wallet' && (
        <>
          {moneyInput('amount', 'Ajuste (negativo para descontar)')}
          <p className="muted">No se permiten saldos negativos.</p>
        </>
      )}
      {kind === 'delivery' && (
        <>
          {text('name', 'Nombre conocido del objeto')}
          {text('description', 'Descripción conocida')}
          {text('private_notes', 'Propiedades / notas privadas')}
          {text('quantity', 'Cantidad', 'number')}
        </>
      )}
      {kind === 'product' && (
        <>
          {text('private_name', 'Nombre real privado')}
          {text('known_name', 'Nombre mostrado del producto')}
          {text('shop_name', 'Nombre visible de la tienda')}
          {text('description', 'Descripción visible')}
          {text('private_notes', 'Notas secretas')}
          {text('stock', 'Existencias reales', 'number')}
          {moneyInput('base_price', 'Precio base')}
        </>
      )}
      {kind === 'catalog' && (
        <>
          <p className="notice">Revelar un producto no revela el resto de la tienda.</p>
          <fieldset>
            <legend>Destinatarios</legend>
            {characters.map((c) => (
              <label className="checkbox" key={c.id}>
                <input
                  type="checkbox"
                  checked={p.characters.includes(c.id)}
                  onChange={(e) =>
                    set(
                      'characters',
                      e.target.checked
                        ? [...p.characters, c.id]
                        : p.characters.filter((id: string) => id !== c.id),
                    )
                  }
                />
                {c.title}
              </label>
            ))}
          </fieldset>
          {moneyInput('offered_price', 'Precio ofrecido')}
          <label>
            Cómo mostrar existencias
            <select
              value={p.stock_visibility}
              onChange={(e) => set('stock_visibility', e.target.value)}
            >
              {['disponible', 'aproximada', 'exacta'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button
            className="button danger"
            type="button"
            disabled={working || !p.characters.length}
            onClick={() => submit(true)}
          >
            Retirar de los seleccionados
          </button>
        </>
      )}
      {kind === 'purchase' && (
        <>
          <p>
            {selected?.known_name} · {formatMoney(selected?.offered_price || '0', currencies)} por
            objeto
          </p>
          {text('quantity', 'Cantidad solicitada', 'number')}
        </>
      )}
      {kind === 'confirm' && (
        <>
          <p>
            {selected?.known_name} ×{selected?.quantity}
          </p>
          {moneyInput('unit_price', 'Precio final negociado por unidad')}
          <p className="notice">
            Se comprobarán el saldo, la autorización y las existencias. Confirmar dos veces la misma
            compra no duplica la entrega.
          </p>
        </>
      )}
      {kind === 'transfer' && (
        <>
          {text('quantity', 'Cantidad', 'number')}
          <label>
            Destino
            <select
              value={p.to_character_id}
              onChange={(e) => set('to_character_id', e.target.value)}
            >
              <option value="">Consumir / retirar del inventario</option>
              {characters
                .filter((c) => c.id !== selected?.character_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="button" onClick={close}>
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={working || (kind === 'catalog' && !p.characters.length)}
        >
          {working
            ? 'Guardando…'
            : kind === 'confirm'
              ? 'Confirmar compra'
              : kind === 'purchase'
                ? 'Enviar solicitud'
                : kind === 'catalog'
                  ? 'Revelar a seleccionados'
                  : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
