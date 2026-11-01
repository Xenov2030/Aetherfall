import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function Inicio() {
  const u = await currentUser();
  if (!u) redirect('/login');
  let campaigns: any[] = [];
  let error = '';
  try {
    campaigns = (
      await (
        await db()
      ).query(
        'SELECT c.id,c.name,c.group_name,c.demo,m.role FROM campaigns c JOIN members m ON m.campaign_id=c.id WHERE m.user_id=$1 AND m.active=true',
        [u.id],
      )
    ).rows;
  } catch {
    error = 'No hay conexión con la base de datos. Revisá la configuración del servidor.';
  }
  if (campaigns.length === 1) redirect(`/campana/${campaigns[0].id}`);
  return (
    <main className="campaign-picker">
      <Link className="brand" href="/">
        Aetherfall
      </Link>
      <h1>Tus campañas</h1>
      {error && <p className="error">{error}</p>}
      {campaigns.length === 0 && !error && (
        <p>No tenés campañas activas. Pedí una invitación a tu máster.</p>
      )}
      <div className="card-grid">
        {campaigns.map((c) => (
          <Link className="card" href={`/campana/${c.id}`} key={c.id}>
            <p className="eyebrow">{c.demo ? 'DEMOSTRACIÓN' : 'CAMPAÑA PRIVADA'}</p>
            <h2>{c.name}</h2>
            <p>{c.group_name}</p>
            <span className="tag">{c.role === 'master' ? 'Máster' : 'Jugador'}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
