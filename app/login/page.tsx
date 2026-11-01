'use client';
import { signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
export default function Login() {
  const [email, setEmail] = useState(''),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [invitation, setInvitation] = useState<{ campaign: string; token: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const campaign = params.get('campana'),
      token = params.get('invitacion');
    if (campaign && token) setInvitation({ campaign, token });
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (invitation) {
        const response = await fetch('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...invitation, email: email.trim().toLowerCase() }),
        });
        if (!response.ok) {
          setError((await response.json()).error);
          return;
        }
      }
      const r = await signIn('email', { email, callbackUrl: '/inicio', redirect: false });
      if (r?.error)
        setError('No se pudo solicitar el acceso. Verificá tu invitación o consultá al máster.');
      else setSent(true);
    } catch {
      setError('No se pudo conectar con el servicio de acceso.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <Link href="/" className="brand">
        <img src="/emblem.svg" width="40" height="40" alt="" />
        Aetherfall
      </Link>
      <section className="login-card">
        <p className="eyebrow">UN UMBRAL ENTRE HISTORIAS</p>
        <h1>Volvé a tu aventura.</h1>
        <p>
          {invitation
            ? 'Unite a la campaña con tu propio correo. Después podrás elegir tu personaje una sola vez.'
            : 'Ingresá tu correo para volver a tu campaña. Si sos nuevo, usá el enlace de invitación que te compartió el máster.'}{' '}
          Te enviaremos un enlace de acceso de un solo uso, válido durante 15 minutos.
        </p>
        {sent ? (
          <div role="status" className="notice">
            Solicitud procesada. Si el acceso está habilitado y el correo está configurado,
            recibirás el enlace. Revisá también la carpeta de spam.
            <button className="button" onClick={() => setSent(false)}>
              Usar otro correo
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Correo electrónico
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="tu@correo.com"
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} className="button primary">
              {busy ? 'Solicitando…' : 'Recibir enlace de acceso →'}
            </button>
          </form>
        )}
        <small>
          No hay contraseñas que recordar. Para recuperar el acceso, solicitá un nuevo enlace. Si
          perdiste tu correo, contactá al máster.
        </small>
      </section>
    </main>
  );
}
