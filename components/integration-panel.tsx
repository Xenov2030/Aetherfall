'use client';
import { useEffect, useState, useCallback } from 'react';
import { KeyRound, Copy, Plus } from 'lucide-react';
type R = Record<string, any>;
export default function IntegrationPanel({
  request,
  run,
}: {
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (fn: () => Promise<unknown>, m?: string) => Promise<boolean>;
}) {
  const [tokens, setTokens] = useState<R[]>([]),
    [name, setName] = useState(''),
    [secret, setSecret] = useState(''),
    [scopes, setScopes] = useState<string[]>(['draft']),
    [error, setError] = useState('');
  const load = useCallback(
    () =>
      request('/integrations')
        .then(setTokens)
        .catch((e) => setError(e.message)),
    [request],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="panel padded spaced">
      <h2>Integraciones opcionales</h2>
      <p className="muted">
        Credenciales revocables limitadas a esta campaña. No conectan automáticamente con ChatGPT y
        nunca permiten revelar o publicar contenido. La lectura, si la habilitás, incluye el archivo
        privado del máster.
      </p>
      {error && <p className="error">{error}</p>}
      {secret && (
        <div className="notice">
          <strong>Guardá esta credencial de forma segura. Solo se muestra ahora.</strong>
          <input
            aria-label="Credencial de integración de un solo vistazo"
            readOnly
            type="password"
            value={secret}
          />
          <div className="form-actions">
            <button
              className="button"
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(secret);
                }, 'Credencial copiada. Guardala fuera del chat y del repositorio.')
              }
            >
              <Copy size={15} />
              Copiar credencial
            </button>
            <button className="button" onClick={() => setSecret('')}>
              Ocultar
            </button>
          </div>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              const t = await request('/integrations', 'POST', { name, scopes });
              setSecret(t.token);
            }, 'Credencial creada sin acceso a publicación')
          ) {
            setName('');
            load();
          }
        }}
      >
        <label>
          Nombre de la integración
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mi herramienta de preparación"
          />
        </label>
        <fieldset>
          <legend>Permisos que vas a conceder</legend>
          {[
            ['read', 'Leer entradas privadas e historial'],
            ['draft', 'Crear y editar borradores'],
            ['files', 'Subir archivos privados y descargar originales'],
            ['folders', 'Crear carpetas y vincular entradas'],
          ].map(([key, label]) => (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={scopes.includes(key)}
                onChange={(e) =>
                  setScopes(e.target.checked ? [...scopes, key] : scopes.filter((s) => s !== key))
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button disabled={!scopes.length} className="button">
          <KeyRound size={15} />
          Crear credencial
        </button>
      </form>
      {tokens.map((t) => (
        <div className="member-row" key={t.id}>
          <span>
            <strong>{t.name}</strong>
            <small>
              {t.scopes.join(', ')} · {t.revoked_at ? 'Revocada' : 'Activa'}
            </small>
          </span>
          {!t.revoked_at && (
            <button
              className="button danger"
              onClick={async () => {
                if (
                  await run(() => request(`/integrations/${t.id}`, 'DELETE'), 'Credencial revocada')
                )
                  load();
              }}
            >
              Revocar
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
