'use client';
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Check, Download } from 'lucide-react';
type R = Record<string, any>;
export default function StoragePanel({
  request,
  run,
}: {
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (fn: () => Promise<unknown>, m?: string) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<R | null>(null),
    [verified, setVerified] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(
    () =>
      request('/storage')
        .then(setStatus)
        .catch((e) => setError(e.message)),
    [request],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="panel padded spaced">
      <h2>
        <Cloud size={20} /> Tu nube
      </h2>
      <p className="muted">
        Tu Google Drive guarda los originales y respaldos. Los datos y permisos de la campaña siguen
        en la base de datos. Las carpetas de Drive permanecen privadas.
      </p>
      {error && <p className="error">{error}</p>}
      {status && (
        <>
          <p className="notice">
            {status.provider === 'drive'
              ? 'Almacenamiento seleccionado: tu Google Drive.'
              : status.provider === 'local'
                ? 'Este entorno de desarrollo usa archivos locales.'
                : 'Este entorno conserva el almacenamiento anterior.'}{' '}
            {verified
              ? 'Se comprobó el acceso a las dos carpetas privadas.'
              : status.driveConfigured
                ? 'La configuración está presente; falta comprobar la conexión.'
                : 'Tu cuenta de Google todavía no está autorizada o faltan las carpetas. Seguí la guía de Google Drive incluida con el proyecto.'}
          </p>
          <div className="form-actions">
            <button
              className="button"
              disabled={!status.driveConfigured}
              onClick={async () => {
                setVerified(false);
                await run(async () => {
                  const r = await request('/storage/check', 'POST', {});
                  setVerified(r.verified === true);
                }, 'Acceso a las carpetas privadas de Google Drive comprobado');
              }}
            >
              <Check size={15} />
              Comprobar mi Drive
            </button>
            <button
              className="button primary"
              disabled={!status.driveConfigured}
              onClick={() =>
                run(
                  () => request('/storage/backup', 'POST', {}),
                  'Respaldo guardado en tu Drive privado',
                )
              }
            >
              <Download size={15} />
              Guardar respaldo en mi Drive
            </button>
          </div>
          <p className="muted spaced">
            El respaldo desde esta pantalla incluye solo información accesible al máster. El
            respaldo administrativo completo se realiza desde el servidor. Los archivos consumen la
            cuota disponible de tu cuenta. No compartas las carpetas de Drive con jugadores: los
            accesos se administran en Aetherfall.
          </p>
        </>
      )}
    </section>
  );
}
