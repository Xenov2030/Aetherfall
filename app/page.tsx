import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await currentUser();
  if (user) redirect('/inicio');
  return (
    <main className="landing">
      <div className="landing-art" />
      <div className="landing-content">
        <img src="/emblem.svg" width="76" height="76" alt="" />
        <p className="eyebrow">EL ARCHIVO DE TU CAMPAÑA</p>
        <h1>Aetherfall</h1>
        <p className="lead">Cada personaje guarda una parte de la historia.</p>
        <p>
          Prepará el próximo encuentro. Conservá los recuerdos.
          <br />
          Revelá cada secreto en su momento.
        </p>
        <Link className="button primary" href="/login">
          Entrar al archivo <span>→</span>
        </Link>
        <small>Acceso privado, por invitación de tu máster.</small>
      </div>
      <footer>
        AETHERFALL <span>Un lugar para las historias que siguen vivas.</span>
      </footer>
    </main>
  );
}
