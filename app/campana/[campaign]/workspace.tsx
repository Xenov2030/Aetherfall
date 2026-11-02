'use client';
import { useCallback, useEffect, useState, useId, cloneElement } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { JournalPanel, CorrespondencePanel } from '@/components/community-panels';
import CommercePanel from '@/components/commerce-panel';
import IntegrationPanel from '@/components/integration-panel';
import { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from '@/lib/upload-limits';
import StoragePanel from '@/components/storage-panel';
import { characterIsSelectable } from '@/lib/character-catalog';
import {
  LayoutDashboard,
  FolderOpen,
  BookOpen,
  Users,
  Compass,
  Mail,
  Feather,
  Flag,
  Settings,
  Search,
  Plus,
  ChevronRight,
  ArrowUpRight,
  Clock,
  FileText,
  Lock,
  Eye,
  Upload,
  Trash2,
  X,
  Menu,
  Dices,
  Map,
  ScrollText,
  Check,
  ChevronDown,
  Download,
  Undo2,
  Link2,
  Image as ImageIcon,
} from 'lucide-react';
type Row = Record<string, any>;
const names: Record<string, string> = {
  session: 'Sesión',
  character: 'Personaje',
  lore: 'Mundo',
  npc: 'NPC',
  villain: 'Villano',
  relic: 'Reliquia',
  mechanic: 'Mecánica',
  idea: 'Idea',
  journal: 'Bitácora',
  moment: 'Momento importante',
  message: 'Correspondencia',
  quest: 'Misión',
  pending: 'Pendiente',
  attendance: 'Asistencia',
  proposal: 'Propuesta',
  roll: 'Tirada',
};
const tabs = [
  ['home', 'Inicio', LayoutDashboard],
  ['archive', 'Archivo', FolderOpen],
  ['session', 'Sesiones', BookOpen],
  ['character', 'Personajes', Users],
  ['discoveries', 'Descubrimientos', Compass],
  ['message', 'Correspondencia', Mail],
  ['journal', 'Bitácoras y momentos', Feather],
  ['quest', 'Misiones y pendientes', Flag],
  ['attendance', 'Asistencia', Check],
  ['commerce', 'Inventario y tiendas', ScrollText],
  ['roll', 'Dados', Dices],
  ['settings', 'Campaña', Settings],
] as const;
const date = (d: any) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : 'Sin fecha';
export default function Workspace({ campaignId }: { campaignId: string }) {
  const [overview, setOverview] = useState<Row | null>(null),
    [tab, setTab] = useState('home'),
    [search, setSearch] = useState(''),
    [folder, setFolder] = useState(''),
    [preview, setPreview] = useState(''),
    [detail, setDetail] = useState<Row | null>(null),
    [create, setCreate] = useState<string | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [folderForm, setFolderForm] = useState(false);
  const base = `/api/campaigns/${campaignId}`;
  const request = useCallback(
    async (path: string, method = 'GET', payload?: unknown) => {
      const response = await fetch(
        `${base}${path}${preview ? (path.includes('?') ? '&' : '?') + `as=${preview}` : ''}`,
        {
          method,
          headers:
            payload instanceof FormData
              ? undefined
              : payload
                ? { 'Content-Type': 'application/json' }
                : undefined,
          body:
            payload instanceof FormData ? payload : payload ? JSON.stringify(payload) : undefined,
          cache: 'no-store',
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
      return data;
    },
    [base, preview],
  );
  const load = useCallback(async () => {
    setError('');
    try {
      setOverview(await request(`/overview${tab === 'trash' ? '?trash=1' : ''}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [request, tab]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setDetail(null);
  }, [preview]);
  async function open(id: string) {
    setError('');
    try {
      setDetail(await request(`/records/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run(action: () => Promise<unknown>, message = 'Cambios guardados') {
    setBusy(true);
    setError('');
    try {
      await action();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const isMaster = overview?.role === 'master',
    readOnly = !!overview?.preview,
    records: Row[] = overview?.records ?? [],
    characters: Row[] = overview?.characters ?? [],
    folders: Row[] = overview?.folders ?? [];
  const filtered = records.filter(
    (r) =>
      (!folder || r.folder_id === folder) &&
      (!search ||
        `${r.title} ${r.body ?? ''} ${JSON.stringify(r.data?.tags ?? '')}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (tab === 'archive' || tab === 'trash' || tab === 'home' || tab === 'discoveries'
        ? tab !== 'discoveries' || r.fragment
        : tab === 'journal'
          ? ['journal', 'moment', 'proposal'].includes(r.kind)
          : tab === 'quest'
            ? ['quest', 'pending'].includes(r.kind)
            : r.kind === tab),
  );
  const nav = (value: string) => {
    setTab(value);
    setFolder('');
    setSearch('');
    setMobile(false);
  };
  return (
    <div className="app-shell">
      <a href="#main" className="skip">
        Saltar al contenido
      </a>
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Link className="brand" href="/inicio">
          <img src="/emblem.svg" width="38" height="38" alt="" />
          Aetherfall
        </Link>
        <div className="campaign-name">
          <span className="tiny-icon">✧</span>
          <div>
            <strong>{overview?.campaign?.name ?? 'Tu campaña'}</strong>
            <small>{overview?.campaign?.group_name ?? 'Archivo privado'}</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">TU CAMPAÑA</p>
        <nav>
          {tabs
            .filter(([id]) => isMaster || !['attendance', 'settings'].includes(id))
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={`nav-item ${tab === id ? 'active' : ''}`}
                onClick={() => nav(id)}
              >
                <Icon size={18} />
                {label}
                {id === 'home' && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        {isMaster && (
          <>
            <p className="nav-label">EL ARCHIVO</p>
            <button
              className={`nav-item ${tab === 'trash' ? 'active' : ''}`}
              onClick={() => nav('trash')}
            >
              <Trash2 size={17} />
              Papelera
            </button>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="private-note">
            <Lock size={14} />
            <span>{isMaster ? 'Tu archivo es privado.' : 'Solo lo que tu personaje conoce.'}</span>
          </div>
          <button className="profile" onClick={() => signOut({ callbackUrl: '/' })}>
            <span className="avatar">{isMaster ? 'M' : 'J'}</span>
            <span>
              <strong>{isMaster ? 'Máster' : 'Jugador'}</strong>
              <small>Cerrar sesión</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Abrir menú"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={22} />
          </button>
          <span className="breadcrumb">
            {overview?.campaign?.name ?? 'Aetherfall'}
            <ChevronRight size={12} />
            <strong>{tab === 'trash' ? 'Papelera' : tabs.find((t) => t[0] === tab)?.[1]}</strong>
          </span>
          <span className="top-status">
            <span />
            {overview?.campaign?.demo
              ? 'Campaña de demostración'
              : isMaster
                ? 'Vista del máster'
                : 'Vista del jugador'}
          </span>
          {isMaster && (
            <label className="view-as">
              <Eye size={15} />
              <select
                aria-label="Ver como personaje"
                value={preview}
                onChange={(e) => setPreview(e.target.value)}
              >
                <option value="">Ver como personaje</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <main id="main" className="workspace">
          {readOnly && (
            <div className="notice">
              Vista de personaje · Solo lectura.{' '}
              <button className="text-button" onClick={() => setPreview('')}>
                Volver al máster
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                className="icon-button"
                aria-label="Cerrar error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="success">
              {notice}
              <button
                className="icon-button"
                aria-label="Cerrar aviso"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">Abriendo el archivo…</div>
          ) : (
            overview && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">
                      {isMaster ? 'DETRÁS DE CADA AVENTURA' : 'TU MEMORIA DE LA AVENTURA'}
                    </p>
                    <h1>
                      {tab === 'home'
                        ? isMaster
                          ? 'Todo listo para la próxima historia.'
                          : 'Antes de volver a jugar.'
                        : tab === 'trash'
                          ? 'Papelera'
                          : tabs.find((t) => t[0] === tab)?.[1]}
                    </h1>
                    <p>
                      {tab === 'home'
                        ? isMaster
                          ? 'Tus notas, tus secretos y el próximo encuentro, en un solo lugar.'
                          : 'Volvé a tus descubrimientos y prepará lo que querés hacer después.'
                        : tab === 'archive'
                          ? 'Un lugar para cada mapa, recuerdo e idea. Todo empieza en privado.'
                          : tab === 'discoveries'
                            ? 'Cada fragmento es una parte de lo que tu personaje conoce.'
                            : tab === 'settings'
                              ? 'Administrá invitaciones y accesos sin borrar la historia.'
                              : 'Conservá lo ocurrido y prepará lo que viene.'}
                    </p>
                  </div>
                  {isMaster &&
                    !['settings', 'trash', 'journal', 'message', 'commerce', 'roll'].includes(
                      tab,
                    ) && (
                      <button
                        className="button primary"
                        onClick={() =>
                          setCreate(
                            ['session', 'character', 'message', 'attendance'].includes(tab)
                              ? tab
                              : 'lore',
                          )
                        }
                      >
                        <Plus size={16} />
                        Crear{' '}
                        {['session', 'character', 'message', 'attendance'].includes(tab)
                          ? names[tab].toLowerCase()
                          : 'contenido'}
                      </button>
                    )}
                </div>
                {!isMaster &&
                  !readOnly &&
                  characters.length === 0 &&
                  overview.characterSelection && (
                    <section className="panel">
                      <h2>Elegí tu personaje</h2>
                      <p>
                        La elección es permanente. Después, solo el máster puede cambiar tu
                        asignación.
                      </p>
                      {overview.characterSelection.locked ? (
                        <p>
                          Tu elección ya está registrada. Pedile al máster que revise tu asignación.
                        </p>
                      ) : overview.characterSelection.available.length === 0 ? (
                        <p>No hay personajes disponibles. Consultá al máster.</p>
                      ) : (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const id = new FormData(e.currentTarget).get('character');
                            if (
                              !id ||
                              !window.confirm(
                                '¿Confirmás este personaje? Solo el máster podrá cambiarlo después.',
                              )
                            )
                              return;
                            await run(
                              () => request(`/characters/${id}/claim`, 'POST', {}),
                              'Personaje asignado',
                            );
                            await load();
                          }}
                        >
                          <Field label="Personaje disponible">
                            <select name="character" required defaultValue="">
                              <option value="" disabled>
                                Seleccioná un personaje
                              </option>
                              {overview.characterSelection.available.map((c: Row) => (
                                <option key={c.id} value={c.id}>
                                  {c.title}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <button className="button primary" disabled={busy}>
                            Confirmar personaje
                          </button>
                        </form>
                      )}
                    </section>
                  )}
                {!isMaster && !readOnly && characters.length > 0 && (
                  <p className="notice">
                    Tu personaje está asignado. Solo el máster puede cambiar esta asignación.
                  </p>
                )}
                {tab === 'home' ? (
                  <>
                    <section className="home-grid">
                      <div className="session-hero">
                        <div className="hero-map" />
                        <div className="hero-content">
                          <span className="tag gold">
                            <span className="dot" />
                            {isMaster ? 'PRÓXIMO ENCUENTRO' : 'TU PRÓXIMO CAPÍTULO'}
                          </span>
                          <p className="hero-number">
                            {isMaster ? 'SESIÓN EN PREPARACIÓN' : 'ANTES DE VOLVER'}
                          </p>
                          <h2>
                            {(isMaster
                              ? records.find(
                                  (r) =>
                                    r.kind === 'session' &&
                                    ['planeado', 'borrador'].includes(r.status),
                                )?.title
                              : characters[0]?.title) ??
                              (isMaster ? 'La historia continúa' : 'Tu aventura continúa')}
                          </h2>
                          <p>
                            {isMaster
                              ? 'Prepará la introducción, revisá los pendientes y encontrá el punto desde donde retomar.'
                              : 'Tus recuerdos y descubrimientos permanecen aquí, entre una partida y la siguiente.'}
                          </p>
                          <button
                            className="button light"
                            onClick={() => {
                              const s = records.find(
                                (r) =>
                                  r.kind === 'session' &&
                                  ['planeado', 'borrador'].includes(r.status),
                              );
                              if (isMaster && s) open(s.id);
                              else if (isMaster) setCreate('session');
                              else nav('discoveries');
                            }}
                          >
                            {isMaster ? 'Preparar sesión' : 'Ver descubrimientos'}
                            <ArrowUpRight size={16} />
                          </button>
                        </div>
                        <div className="hero-footer">
                          <Lock size={13} />
                          {isMaster
                            ? 'Preparación privada · Solo vos podés verla'
                            : 'Información autorizada para tus personajes'}
                        </div>
                      </div>
                      <section className="panel quick-panel">
                        <div className="section-title">
                          <h2>{isMaster ? 'A mano, cuando hace falta' : 'Tu espacio'}</h2>
                          <span>✧</span>
                        </div>
                        {(isMaster
                          ? [
                              [
                                Upload,
                                'Subir archivos',
                                'Mapas, imágenes y documentos',
                                () => {
                                  nav('archive');
                                  setNotice(
                                    'Abrí un recurso o creá uno para adjuntar archivos privados.',
                                  );
                                },
                              ],
                              [
                                Feather,
                                'Una nota rápida',
                                'Antes de que se pierda la idea',
                                () => setCreate('idea'),
                              ],
                              [
                                Compass,
                                'Revelar un descubrimiento',
                                'Elegí qué sabe cada personaje',
                                () => {
                                  nav('archive');
                                  setNotice('Abrí un recurso y usá la pestaña Revelaciones.');
                                },
                              ],
                            ]
                          : [
                              [
                                Users,
                                'Mi ficha',
                                'El respaldo de tu hoja de papel',
                                () => nav('character'),
                              ],
                              [
                                Compass,
                                'Mis descubrimientos',
                                'Lo que viviste o te contaron',
                                () => nav('discoveries'),
                              ],
                              [
                                Feather,
                                'Proponer un relato',
                                'Tu interpretación de lo vivido',
                                () => nav('journal'),
                              ],
                            ]
                        ).map(([Icon, title, subtitle, action]: any) => (
                          <button className="quick-action" key={title} onClick={action}>
                            <span className="quick-icon">
                              <Icon size={19} />
                            </span>
                            <span>
                              <strong>{title}</strong>
                              <small>{subtitle}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                        <p className="quiet-note">
                          <Lock size={12} />
                          {isMaster
                            ? 'Crear y guardar no significa publicar.'
                            : 'Tus propuestas no cambian el canon automáticamente.'}
                        </p>
                      </section>
                    </section>
                    <div className="stat-grid">
                      {(isMaster
                        ? [
                            [
                              BookOpen,
                              records.filter((r) => r.kind === 'session').length,
                              'Sesiones en el archivo',
                            ],
                            [
                              FolderOpen,
                              records.filter(
                                (r) => !['character', 'session', 'roll'].includes(r.kind),
                              ).length,
                              'Recursos guardados',
                            ],
                            [Users, characters.length, 'Personajes'],
                            [
                              Clock,
                              records.filter(
                                (r) =>
                                  ['pending', 'proposal'].includes(r.kind) &&
                                  r.status === 'pendiente',
                              ).length,
                              'Pendientes por revisar',
                            ],
                          ]
                        : [
                            [Users, characters.length, 'Mis personajes'],
                            [
                              Compass,
                              records.filter((r) => r.fragment).length,
                              'Fragmentos recibidos',
                            ],
                            [Mail, overview.threadCount ?? 0, 'Comunicaciones'],
                            [Feather, overview.ownProposals.length, 'Aportaciones'],
                          ]
                      ).map(([Icon, count, label]: any) => (
                        <div className="stat" key={label}>
                          <Icon size={19} />
                          <div>
                            <strong>{count}</strong>
                            <span>{label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <section className="lower-grid">
                      <section className="panel">
                        <div className="section-title">
                          <h2>
                            {isMaster
                              ? 'Últimos movimientos del archivo'
                              : 'Descubrimientos recientes'}
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => nav(isMaster ? 'archive' : 'discoveries')}
                          >
                            Ver todo <ArrowUpRight size={14} />
                          </button>
                        </div>
                        <RecordList
                          records={records.filter((r) => isMaster || r.fragment).slice(0, 5)}
                          open={open}
                        />
                      </section>
                      <section className="panel">
                        <div className="section-title">
                          <h2>{isMaster ? 'La compañía' : 'Tus personajes'}</h2>
                          <Users size={16} />
                        </div>
                        {characters.map((c, i) => (
                          <button className="character-row" key={c.id} onClick={() => open(c.id)}>
                            <span className={`character-seal seal-${i % 3}`}>
                              {c.title.charAt(0)}
                            </span>
                            <span>
                              <strong>{c.title}</strong>
                              <small>
                                {isMaster
                                  ? 'Ficha y conocimiento individual'
                                  : 'Tu ficha de respaldo'}
                              </small>
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                        {!characters.length && (
                          <Empty text="Todavía no hay personajes asignados." />
                        )}
                        <div className="panel-footer">
                          {isMaster
                            ? 'Cada personaje conoce su propia historia.'
                            : characters.length
                              ? 'Tu ficha conserva el historial de cambios.'
                              : 'Consultá al máster para asignar un personaje.'}
                        </div>
                      </section>
                    </section>
                  </>
                ) : tab === 'settings' ? (
                  <SettingsPanel data={overview} request={request} run={run} base={base} />
                ) : tab === 'journal' ? (
                  <JournalPanel
                    request={request}
                    run={run}
                    characters={characters}
                    master={!!isMaster}
                    readOnly={readOnly}
                    knownCharacters={records
                      .filter((r) => r.kind === 'character' && r.fragment)
                      .map((r) => ({ id: r.record_id, title: r.title }))}
                  />
                ) : tab === 'message' ? (
                  <CorrespondencePanel
                    request={request}
                    run={run}
                    characters={characters}
                    master={!!isMaster}
                    readOnly={readOnly}
                  />
                ) : tab === 'commerce' ? (
                  <CommercePanel
                    request={request}
                    run={run}
                    characters={characters}
                    master={!!isMaster}
                    readOnly={readOnly}
                  />
                ) : tab === 'roll' ? (
                  <DicePanel data={overview} request={request} run={run} readOnly={readOnly} />
                ) : (
                  <>
                    {tab === 'archive' && isMaster && (
                      <div className="folder-strip">
                        <button
                          className={`folder-chip ${!folder ? 'selected' : ''}`}
                          onClick={() => setFolder('')}
                        >
                          <FolderOpen size={16} />
                          Todo el archivo
                        </button>
                        <button
                          className={`folder-chip ${folder === 'inbox' ? 'selected' : ''}`}
                          onClick={() => setFolder('inbox')}
                        >
                          Sin clasificar
                        </button>
                        {folders.map((f) => (
                          <button
                            key={f.id}
                            className={`folder-chip ${folder === f.id ? 'selected' : ''}`}
                            onClick={() => setFolder(f.id)}
                          >
                            <FolderOpen size={15} />
                            {f.parent_id ? '↳ ' : ''}
                            {f.name}
                          </button>
                        ))}
                        <button className="folder-chip" onClick={() => setFolderForm(true)}>
                          <Plus size={15} />
                          Carpeta
                        </button>
                      </div>
                    )}
                    <div className="list-toolbar">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          aria-label="Buscar contenido autorizado"
                          placeholder="Buscar en este archivo…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <kbd>⌕</kbd>
                      </label>
                      <span className="muted">
                        {
                          (folder === 'inbox' ? records.filter((r) => !r.folder_id) : filtered)
                            .length
                        }{' '}
                        entradas
                      </span>
                      {isMaster && folder && folder !== 'inbox' && (
                        <button className="button" onClick={() => setFolderForm(true)}>
                          Editar carpeta
                        </button>
                      )}
                      {!isMaster &&
                        !readOnly &&
                        ['journal', 'quest', 'character', 'discoveries'].includes(tab) && (
                          <button className="button" onClick={() => setCreate('proposal')}>
                            <Plus size={15} />
                            Proponer al máster
                          </button>
                        )}
                    </div>
                    <section className="panel">
                      <div className="table-head">
                        <span>CONTENIDO</span>
                        <span>TIPO</span>
                        <span>{isMaster ? 'ESTADO' : 'ORIGEN'}</span>
                        <span>ACTUALIZADO</span>
                      </div>
                      <RecordList
                        records={
                          folder === 'inbox'
                            ? records.filter(
                                (r) =>
                                  !r.folder_id &&
                                  (!search || r.title.toLowerCase().includes(search.toLowerCase())),
                              )
                            : filtered
                        }
                        open={
                          tab === 'trash'
                            ? async (id) => {
                                if (
                                  await run(
                                    () => request(`/records/${id}/restore`, 'POST', {}),
                                    'Contenido restaurado',
                                  )
                                )
                                  setDetail(null);
                              }
                            : open
                        }
                      />
                      {tab === 'trash' && filtered.length > 0 && (
                        <p className="panel-footer">
                          Seleccioná una entrada para restaurarla. No se eliminan archivos
                          permanentemente.
                        </p>
                      )}
                    </section>
                    {!isMaster && tab === 'journal' && (
                      <section className="panel spaced">
                        <div className="section-title">
                          <h2>Tus propuestas al máster</h2>
                        </div>
                        {overview.ownProposals.map((p: Row) => (
                          <article className="proposal-item" key={p.id}>
                            <strong>{p.title}</strong>
                            <span className="tag">{p.status}</span>
                            <p>{p.body}</p>
                          </article>
                        ))}
                        {!overview.ownProposals.length && (
                          <Empty text="Los relatos son voluntarios y no dan ventajas mecánicas." />
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )
          )}
          {detail && (
            <DetailDrawer
              detail={detail}
              master={!!isMaster}
              readOnly={readOnly}
              characters={characters}
              members={overview?.members ?? []}
              folders={folders}
              request={request}
              run={run}
              refresh={() => open(detail.record.id)}
              close={() => setDetail(null)}
              base={base}
              preview={preview}
            />
          )}
          {create && (
            <RecordModal
              initialKind={create}
              characters={characters}
              folders={folders}
              close={() => setCreate(null)}
              save={async (payload) => {
                const ok = await run(
                  () => request(create === 'proposal' ? '/proposals' : '/records', 'POST', payload),
                  create === 'proposal'
                    ? 'Propuesta enviada al máster. El canon no se modificó.'
                    : 'Contenido guardado en privado',
                );
                if (ok) setCreate(null);
              }}
            />
          )}
          {folderForm && (
            <FolderModal
              folders={folders}
              selected={folders.find((f) => f.id === folder)}
              close={() => setFolderForm(false)}
              save={async (payload) => {
                const ok = await run(() =>
                  request(
                    `/folders${folder && folder !== 'inbox' ? '/' + folder : ''}`,
                    folder && folder !== 'inbox' ? 'PATCH' : 'POST',
                    payload,
                  ),
                );
                if (ok) setFolderForm(false);
              }}
            />
          )}
          {busy && (
            <div className="saving" role="status">
              Guardando…
            </div>
          )}
        </main>
        <footer className="workspace-footer">
          <span>AETHERFALL</span>
          <span>La próxima historia empieza donde la dejamos.</span>
          <Lock size={12} />
        </footer>
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ScrollText size={27} />
      <p>{text}</p>
    </div>
  );
}
function RecordList({ records, open }: { records: Row[]; open: (id: string) => void }) {
  return records.length ? (
    <div className="record-list">
      {records.map((r, i) => (
        <button
          className="record-row"
          key={`${r.id}-${r.character_id ?? i}`}
          onClick={() => open(r.id)}
        >
          <span className={`record-icon kind-${r.kind}`}>
            {r.kind === 'session' ? (
              <BookOpen size={19} />
            ) : r.kind === 'character' ? (
              <Users size={19} />
            ) : r.kind === 'lore' ? (
              <Map size={19} />
            ) : (
              <FileText size={19} />
            )}
          </span>
          <span className="record-title">
            <strong>{r.title}</strong>
            <small>
              {r.fragment
                ? 'Fragmento revelado'
                : r.kind === 'character'
                  ? 'Ficha de respaldo'
                  : 'Archivo privado'}
            </small>
          </span>
          <span className="record-type">{names[r.kind] ?? r.kind}</span>
          <span className="tag">{r.source ?? r.status ?? 'Personal'}</span>
          <span className="record-date">{date(r.updated_at ?? r.granted_at)}</span>
          <ChevronRight size={14} />
        </button>
      ))}
    </div>
  ) : (
    <Empty text="Este capítulo todavía está en blanco. Cuando haya contenido, aparecerá aquí." />
  );
}
const sessionFields = [
  ['number', 'Número', 'number'],
  ['date', 'Fecha real', 'date'],
  ['worldTime', 'Momento del mundo', 'text'],
  ['introduction', 'Relato de introducción', 'textarea'],
  ['summary', 'Resumen privado de lo ocurrido', 'textarea'],
  ['closing', 'Relato de cierre', 'textarea'],
  ['pending', 'Asuntos pendientes', 'textarea'],
  ['resume', 'Punto desde donde retomaremos', 'textarea'],
] as const;
const characterFields = [
  ['species', 'Especie'],
  ['class', 'Clase'],
  ['subclass', 'Subclase'],
  ['level', 'Nivel'],
  ['background', 'Trasfondo'],
  ['attributes', 'Atributos, competencias y salvaciones'],
  ['combat', 'Vida, CA, iniciativa, velocidad y estados'],
  ['abilities', 'Ataques, conjuros y habilidades'],
  ['inventory', 'Inventario y monedas'],
] as const;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as React.ReactElement<{ id: string }>, { id })}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useDialog(close);
  return (
    <div className="overlay" onClick={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function RecordModal({
  initialKind,
  characters,
  folders,
  close,
  save,
}: {
  initialKind: string;
  characters: Row[];
  folders: Row[];
  close: () => void;
  save: (p: Row) => Promise<void>;
}) {
  const [selfSelectable, setSelfSelectable] = useState(false);
  const [kind, setKind] = useState(initialKind),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [status, setStatus] = useState('borrador'),
    [folder, setFolder] = useState(''),
    [data, setData] = useState<Row>({}),
    [char, setChar] = useState(characters[0]?.id ?? ''),
    [type, setType] = useState('relato'),
    [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setData((d) => ({ ...d, [k]: v }));
  return (
    <Modal
      title={
        initialKind === 'proposal' ? 'Una aportación a la historia' : 'Crear contenido privado'
      }
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await save(
            initialKind === 'proposal'
              ? { title, body, character_id: char, type }
              : {
                  kind,
                  title,
                  body,
                  status,
                  folder_id: folder || null,
                  data: kind === 'character' ? { sheet: data, editable: [], selfSelectable } : data,
                },
          );
          setSaving(false);
        }}
      >
        <div className="form-grid">
          {initialKind !== 'proposal' && (
            <>
              <Field label="Tipo">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(names)
                    .filter(([k]) => !['proposal', 'roll'].includes(k))
                    .map(([k, n]) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Estado">
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {[
                    'borrador',
                    'vigente',
                    'planeado',
                    'rumor',
                    'descartado',
                    'final',
                    'pendiente',
                    'realizada',
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
        <Field label="Título">
          <input
            autoFocus
            required
            maxLength={180}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Dale un nombre a esta entrada"
          />
        </Field>
        {initialKind === 'proposal' ? (
          <div className="form-grid">
            <Field label="Personaje">
              <select required value={char} onChange={(e) => setChar(e.target.value)}>
                <option value="">Elegí un personaje</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo de aportación">
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {['relato', 'npc', 'pendiente', 'compartir', 'ficha', 'intención'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <Field label="Carpeta principal">
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">Bandeja de entrada · Sin clasificar</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={
            initialKind === 'proposal' ? 'Tu aportación' : 'Contenido / notas privadas del máster'
          }
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={initialKind === 'proposal' ? 20000 : 60000}
            rows={5}
            placeholder="Escribí sin prisa. Podés ampliar esta entrada después."
          />
        </Field>
        {kind === 'session' &&
          sessionFields.map(([k, label, type]) => (
            <Field key={k} label={label}>
              {type === 'textarea' ? (
                <textarea rows={3} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              ) : (
                <input type={type} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              )}
            </Field>
          ))}
        {kind === 'character' && (
          <>
            <p className="notice">
              Dejá vacíos los datos que todavía no están definidos. La ficha no se comparte con
              otros jugadores.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={selfSelectable}
                onChange={(e) => setSelfSelectable(e.target.checked)}
              />
              Disponible para la elección inicial de jugadores (solo se mostrará el nombre)
            </label>
            <div className="form-grid">
              {characterFields.map(([k, label]) => (
                <Field key={k} label={label}>
                  <input value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                </Field>
              ))}
            </div>
          </>
        )}
        {kind === 'attendance' && (
          <>
            <Field label="Personaje">
              <select
                onChange={(e) => set('characterId', e.target.value)}
                value={data.characterId ?? ''}
              >
                <option value="">Sin asignar</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Participación">
              <select
                value={data.participation ?? ''}
                onChange={(e) => set('participation', e.target.value)}
              >
                <option value="">Sin definir</option>
                {['presente', 'ausente', 'parcial'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            {[
              ['location', 'Ubicación del personaje'],
              ['before', 'Qué sabía antes'],
              ['experienced', 'Qué vivió'],
              ['told', 'Qué le contaron después'],
              ['return', 'Cómo se reincorpora'],
              ['continuity', 'Pendientes de continuidad'],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                <textarea rows={2} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
            <p className="notice">
              Registrar asistencia no revela contenido. Un personaje ausente permanece donde decida
              el máster.
            </p>
          </>
        )}
        {['quest', 'pending'].includes(kind) && (
          <>
            {[
              ['knownUrgency', 'Urgencia conocida'],
              ['knownConsequences', 'Consecuencias conocidas'],
              ['realConsequences', 'Consecuencias reales privadas'],
              ['worldDeadline', 'Plazo en el mundo (opcional)'],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                <input value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
            <p className="quiet-note">
              La aplicación no avanza el tiempo ni resuelve consecuencias.
            </p>
          </>
        )}
        {kind === 'relic' && (
          <>
            {[
              ['current', 'Estado real vigente'],
              ['known', 'Propiedades conocidas'],
              ['planned', 'Evoluciones planeadas'],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                <textarea rows={3} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
          </>
        )}
        <div className="form-actions">
          <span>
            <Lock size={13} />{' '}
            {initialKind === 'proposal'
              ? 'El máster revisa antes de cambiar el canon.'
              : 'Se guarda en privado. Revelar es otra acción.'}
          </span>
          <button className="button primary" disabled={saving}>
            {saving
              ? 'Guardando…'
              : initialKind === 'proposal'
                ? 'Enviar al máster'
                : 'Guardar en privado'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DetailDrawer({
  detail,
  master: canManage,
  readOnly,
  characters,
  members,
  folders,
  request,
  run,
  refresh,
  close,
  base,
  preview,
}: {
  detail: Row;
  master: boolean;
  readOnly: boolean;
  characters: Row[];
  members: Row[];
  folders: Row[];
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (a: () => Promise<unknown>, m?: string) => Promise<boolean>;
  refresh: () => void;
  close: () => void;
  base: string;
  preview: string;
}) {
  const r = detail.record;
  const [section, setSection] = useState('content'),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(r.title),
    [body, setBody] = useState(r.body ?? ''),
    [status, setStatus] = useState(r.status ?? 'borrador'),
    [folder, setFolder] = useState(r.folder_id ?? ''),
    [data, setData] = useState(JSON.stringify(r.data ?? {}, null, 2)),
    [fragTitle, setFragTitle] = useState(''),
    [fragBody, setFragBody] = useState(''),
    [attachmentFragment, setAttachmentFragment] = useState(''),
    [linkTarget, setLinkTarget] = useState(''),
    [notes, setNotes] = useState(r.data?.playerNotes ?? ''),
    [uploading, setUploading] = useState(false),
    [resourceText, setResourceText] = useState(JSON.stringify(r.data?.resources ?? {}, null, 2));
  useDialog(close);
  useEffect(() => {
    setTitle(r.title);
    setBody(r.body ?? '');
    setStatus(r.status ?? 'borrador');
    setFolder(r.folder_id ?? '');
    setData(JSON.stringify(r.data ?? {}, null, 2));
    setNotes(r.data?.playerNotes ?? '');
    setEditing(false);
  }, [r.id, r.version]);
  const fileUrl = (id: string) => `${base}/attachments/${id}${preview ? '?as=' + preview : ''}`;
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set('record_id', r.id);
      form.set('file', file);
      if (attachmentFragment) form.set('fragment_id', attachmentFragment);
      if (
        !(await run(async () => {
          if (file.size > MAX_FILE_BYTES) throw new Error('El archivo no puede superar los 15 MB');
          if (file.size <= UPLOAD_CHUNK_BYTES) return request('/attachments', 'POST', form);
          const session = await request('/uploads', 'POST', {
            record_id: r.id,
            fragment_id: attachmentFragment || null,
            name: file.name.slice(0, 180),
            mime: file.type,
            size: file.size,
          });
          try {
            for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
              const response = await fetch(`${base}/uploads/${session.id}?offset=${offset}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file.slice(offset, offset + UPLOAD_CHUNK_BYTES),
              });
              if (!response.ok)
                throw new Error((await response.json()).error || 'No se pudo cargar la imagen');
            }
            return await request(`/uploads/${session.id}/complete`, 'POST', {});
          } catch (error) {
            await request(`/uploads/${session.id}`, 'DELETE').catch(() => {});
            throw error;
          }
        }, 'Archivo guardado con sus permisos'))
      )
        break;
    }
    setUploading(false);
    refresh();
  }
  return (
    <div className="drawer-overlay" onClick={close}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={r.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <span className="eyebrow">
            {names[r.kind]} ·{' '}
            {canManage ? 'ARCHIVO PRIVADO' : r.fragment ? 'FRAGMENTO REVELADO' : 'FICHA PERSONAL'}
          </span>
          <button className="icon-button" onClick={close} aria-label="Cerrar detalle">
            <X size={21} />
          </button>
        </div>
        <h2 className="drawer-title">{r.title}</h2>
        <div className="drawer-meta">
          <span className="tag">{r.status ?? r.source ?? 'Personal'}</span>
          <span>Actualizado: {date(r.updated_at ?? r.granted_at)}</span>
          {r.version && <span>Versión {r.version}</span>}
        </div>
        <div className="detail-tabs">
          {[
            ['content', 'Contenido'],
            ...(canManage ? [['fragments', 'Revelaciones']] : []),
            ['files', 'Adjuntos'],
            ...(canManage ? [['history', 'Historial']] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              {label}
              {id === 'files' ? ` (${detail.attachments.length})` : ''}
            </button>
          ))}
        </div>
        {section === 'content' && (
          <>
            {editing ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(() => {
                      const payload = {
                        version: r.version,
                        title,
                        body,
                        status,
                        folder_id: folder || null,
                        data: JSON.parse(data),
                      };
                      return request(`/records/${r.id}`, 'PATCH', payload);
                    })
                  ) {
                    setEditing(false);
                    refresh();
                  }
                }}
              >
                <Field label="Título">
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={180}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Estado">
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      {[
                        'borrador',
                        'vigente',
                        'planeado',
                        'rumor',
                        'descartado',
                        'final',
                        'pendiente',
                        'realizada',
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Carpeta">
                    <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                      <option value="">Sin clasificar</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Contenido privado">
                  <textarea
                    rows={9}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={60000}
                  />
                </Field>
                {r.kind === 'session' ? (
                  sessionFields.map(([k, label, type]) => (
                    <Field key={k} label={label}>
                      {type === 'textarea' ? (
                        <textarea
                          rows={3}
                          value={JSON.parse(data)[k] ?? ''}
                          onChange={(e) =>
                            setData(
                              JSON.stringify({ ...JSON.parse(data), [k]: e.target.value }, null, 2),
                            )
                          }
                        />
                      ) : (
                        <input
                          type={type}
                          value={JSON.parse(data)[k] ?? ''}
                          onChange={(e) =>
                            setData(
                              JSON.stringify({ ...JSON.parse(data), [k]: e.target.value }, null, 2),
                            )
                          }
                        />
                      )}
                    </Field>
                  ))
                ) : r.kind === 'character' ? (
                  <>
                    <div className="form-grid">
                      {characterFields.map(([k, label]) => (
                        <Field key={k} label={label}>
                          <input
                            value={JSON.parse(data).sheet?.[k] ?? ''}
                            onChange={(e) => {
                              const d = JSON.parse(data);
                              setData(
                                JSON.stringify(
                                  { ...d, sheet: { ...d.sheet, [k]: e.target.value } },
                                  null,
                                  2,
                                ),
                              );
                            }}
                          />
                        </Field>
                      ))}
                    </div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={characterIsSelectable(r.title, JSON.parse(data))}
                        onChange={(e) =>
                          setData(
                            JSON.stringify(
                              { ...JSON.parse(data), selfSelectable: e.target.checked },
                              null,
                              2,
                            ),
                          )
                        }
                      />
                      Disponible para la elección inicial de jugadores (solo se mostrará el nombre)
                    </label>
                    <fieldset>
                      <legend>Edición permitida al propietario</legend>
                      {[
                        ['playerNotes', 'Notas personales'],
                        ['resources', 'Recursos y contadores'],
                      ].map(([key, label]) => (
                        <label className="checkbox" key={key}>
                          <input
                            type="checkbox"
                            checked={JSON.parse(data).editable?.includes(key) ?? false}
                            onChange={(e) => {
                              const d = JSON.parse(data);
                              setData(
                                JSON.stringify(
                                  {
                                    ...d,
                                    editable: e.target.checked
                                      ? [...new Set([...(d.editable ?? []), key])]
                                      : d.editable?.filter((v: string) => v !== key),
                                  },
                                  null,
                                  2,
                                ),
                              );
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : (
                  <Field label="Datos complementarios (JSON)">
                    <textarea
                      className="code-input"
                      rows={8}
                      value={data}
                      onChange={(e) => setData(e.target.value)}
                    />
                  </Field>
                )}
                <div className="form-actions">
                  <button type="button" className="button" onClick={() => setEditing(false)}>
                    Cancelar
                  </button>
                  <button className="button primary">Guardar nueva versión</button>
                </div>
              </form>
            ) : (
              <>
                <article className="prose">
                  <p className="preserve">
                    {r.body ||
                      (r.kind === 'character'
                        ? 'Un respaldo de la hoja de papel. Completá solo los datos que quieras registrar.'
                        : 'Todavía no hay contenido escrito.')}
                  </p>
                  {r.kind === 'session' ? (
                    sessionFields.map(([key, label]) =>
                      r.data?.[key] ? (
                        <section key={key}>
                          <h3>{label}</h3>
                          <p className="preserve">{r.data[key]}</p>
                        </section>
                      ) : null,
                    )
                  ) : r.kind === 'character' ? (
                    <>
                      <div className="sheet-grid">
                        {characterFields.map(([k, label]) => (
                          <div key={k}>
                            <small>{label}</small>
                            <strong>{r.data?.sheet?.[k] || 'Sin registrar'}</strong>
                          </div>
                        ))}
                      </div>
                      {r.data?.playerNotes && (
                        <>
                          <h3>Notas personales</h3>
                          <p className="preserve">{r.data.playerNotes}</p>
                        </>
                      )}
                      {r.data?.resources && (
                        <>
                          <h3>Recursos registrados</h3>
                          <pre>{JSON.stringify(r.data.resources, null, 2)}</pre>
                        </>
                      )}
                    </>
                  ) : r.data && Object.keys(r.data).length > 0 ? (
                    <dl className="data-list">
                      {Object.entries(r.data).map(([k, v]) => (
                        <div key={k}>
                          <dt>
                            {(
                              {
                                knownUrgency: 'Urgencia conocida',
                                knownConsequences: 'Consecuencias conocidas',
                                realConsequences: 'Consecuencias reales privadas',
                                worldDeadline: 'Plazo en el mundo',
                                current: 'Estado vigente',
                                planned: 'Evolución planeada',
                                known: 'Propiedades conocidas',
                                location: 'Ubicación',
                                participation: 'Participación',
                                before: 'Qué sabía antes',
                                experienced: 'Qué vivió',
                                told: 'Qué le contaron',
                                return: 'Reincorporación',
                                continuity: 'Continuidad',
                              } as Row
                            )[k] ?? k}
                          </dt>
                          <dd className="preserve">
                            {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </article>
                <div className="form-actions">
                  {canManage && (
                    <button className="button primary" onClick={() => setEditing(true)}>
                      <Feather size={15} />
                      Editar entrada
                    </button>
                  )}
                  <button className="button" onClick={() => window.print()}>
                    <Download size={15} />
                    Imprimir
                  </button>
                </div>
                {!canManage &&
                  !readOnly &&
                  r.kind === 'character' &&
                  r.data?.editable?.includes('playerNotes') && (
                    <form
                      className="spaced"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await run(() =>
                            request(`/records/${r.id}`, 'PATCH', {
                              version: r.version,
                              data: { playerNotes: notes },
                            }),
                          )
                        )
                          refresh();
                      }}
                    >
                      <Field label="Mis notas personales">
                        <textarea
                          rows={4}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </Field>
                      <button className="button primary">Guardar notas</button>
                    </form>
                  )}
                {!canManage &&
                  !readOnly &&
                  r.kind === 'character' &&
                  r.data?.editable?.includes('resources') && (
                    <form
                      className="spaced"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await run(() =>
                          request(`/records/${r.id}`, 'PATCH', {
                            version: r.version,
                            data: { resources: JSON.parse(resourceText) },
                          }),
                        );
                        refresh();
                      }}
                    >
                      <Field label="Recursos y contadores (JSON)">
                        <textarea
                          rows={3}
                          value={resourceText}
                          onChange={(e) => setResourceText(e.target.value)}
                        />
                      </Field>
                      <button className="button">Guardar recursos</button>
                    </form>
                  )}
                {canManage && r.kind === 'character' && (
                  <Field label="Propietario de la ficha">
                    <select
                      value={r.owner_id ?? ''}
                      onChange={async (e) => {
                        if (
                          await run(() =>
                            request(`/records/${r.id}/assign`, 'POST', {
                              user_id: e.target.value || null,
                            }),
                          )
                        )
                          refresh();
                      }}
                    >
                      <option value="">Sin asignar</option>
                      {members
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name ?? m.email}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {canManage && (
                  <section className="spaced">
                    <h3>Vínculos del archivo</h3>
                    <p className="muted">
                      Vincular una sesión o entidad no concede acceso a su contenido.
                    </p>
                    {detail.links.map((l: Row) => (
                      <p key={l.id}>{l.title}</p>
                    ))}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await run(() =>
                            request(`/records/${r.id}/links`, 'POST', { target_id: linkTarget }),
                          )
                        ) {
                          setLinkTarget('');
                          refresh();
                        }
                      }}
                    >
                      <Field label="ID de la entrada a vincular">
                        <input
                          value={linkTarget}
                          onChange={(e) => setLinkTarget(e.target.value)}
                          required
                          placeholder="UUID de una entrada de esta campaña"
                        />
                      </Field>
                      <button className="button">
                        <Link2 size={14} />
                        Vincular
                      </button>
                    </form>
                  </section>
                )}
                {canManage && (
                  <div className="danger-zone">
                    <button
                      className="text-button danger"
                      onClick={async () => {
                        if (
                          window.confirm(
                            '¿Mover esta entrada a la papelera? Los jugadores perderán el acceso hasta que la restaures.',
                          )
                        )
                          if (await run(() => request(`/records/${r.id}`, 'DELETE'))) close();
                      }}
                    >
                      <Trash2 size={14} />
                      Mover a papelera
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {section === 'fragments' && (
          <>
            <p className="notice">
              <Lock size={15} />
              La información privada de esta entrada nunca se comparte automáticamente. Prepará un
              fragmento con su propio nombre y texto, y después elegí destinatarios.
            </p>
            {detail.fragments.map((f: Row) => (
              <FragmentCard
                key={f.id}
                fragment={f}
                characters={characters}
                save={async (payload) => {
                  if (
                    await run(
                      () => request(`/fragments/${f.id}`, 'POST', payload),
                      payload.revoke
                        ? 'Acceso retirado. Esto no borra lo que ya vieron o descargaron.'
                        : 'Fragmento revelado a los personajes seleccionados',
                    )
                  )
                    refresh();
                }}
              />
            ))}
            <form
              className="fragment-composer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run(
                    () =>
                      request(`/records/${r.id}/fragments`, 'POST', {
                        title: fragTitle,
                        body: fragBody,
                      }),
                    'Fragmento preparado. Todavía no tiene destinatarios.',
                  )
                ) {
                  setFragTitle('');
                  setFragBody('');
                  refresh();
                }
              }}
            >
              <h3>Preparar un fragmento</h3>
              <Field label="Nombre que conocerán los personajes">
                <input
                  required
                  value={fragTitle}
                  onChange={(e) => setFragTitle(e.target.value)}
                  maxLength={180}
                />
              </Field>
              <Field label="Contenido revelable">
                <textarea
                  rows={5}
                  required
                  value={fragBody}
                  onChange={(e) => setFragBody(e.target.value)}
                  maxLength={60000}
                />
              </Field>
              <button className="button">
                <Plus size={15} />
                Guardar fragmento privado
              </button>
            </form>
          </>
        )}
        {section === 'files' && (
          <>
            <p className="notice">
              {canManage
                ? 'Los archivos privados no aparecen a jugadores. Para compartir uno, adjuntalo a un fragmento y revelá ese fragmento. Máximo 15 MB por archivo.'
                : 'Las descargas requieren autorización en el servidor. Si se usa S3, sus enlaces temporales caducan en 60 segundos.'}
            </p>
            {canManage && (
              <div className="upload-box">
                <Upload size={26} />
                <h3>Conservá el original</h3>
                <p>PNG, JPG, WebP, PDF o texto · Hasta 15 MB</p>
                <Field label="Visibilidad del archivo">
                  <select
                    value={attachmentFragment}
                    onChange={(e) => setAttachmentFragment(e.target.value)}
                  >
                    <option value="">Privado del máster</option>
                    {detail.fragments.map((f: Row) => (
                      <option key={f.id} value={f.id}>
                        Fragmento: {f.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="button">
                  {uploading ? 'Subiendo…' : 'Seleccionar archivos'}
                  <input
                    className="file-input"
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                    disabled={uploading}
                    onChange={(e) => upload(e.target.files)}
                  />
                </label>
              </div>
            )}
            {detail.attachments.map((f: Row) => (
              <article className="file-card" key={f.id}>
                {f.mime.startsWith('image/') ? (
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(f.id)} alt={f.name} loading="lazy" />
                  </a>
                ) : f.mime === 'application/pdf' ? (
                  <a className="pdf-preview" href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                    <FileText size={36} />
                    <span>Ver PDF en una pestaña nueva</span>
                  </a>
                ) : null}
                <div>
                  <FileText size={18} />
                  <span>
                    <strong>{f.name}</strong>
                    <small>
                      {(f.size / 1024).toFixed(1)} KB{' '}
                      {canManage ? (f.fragment_id ? '· Vinculado a fragmento' : '· Privado') : ''}
                    </small>
                  </span>
                  <a className="button" href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                    Abrir <ArrowUpRight size={14} />
                  </a>
                </div>
              </article>
            ))}
            {!detail.attachments.length && (
              <Empty text="Todavía no hay archivos disponibles en esta entrada." />
            )}
          </>
        )}
        {section === 'history' && (
          <>
            <p className="muted">
              Restaurar genera una nueva versión. No cambia revelaciones ni destinatarios.
            </p>
            {detail.revisions.map((v: Row) => (
              <div className="revision" key={v.version}>
                <span>
                  <strong>Versión {v.version}</strong>
                  <small>
                    {date(v.created_at)} · {v.snapshot.title}
                  </small>
                </span>
                {v.version !== r.version && (
                  <button
                    className="button"
                    onClick={async () => {
                      if (window.confirm(`¿Restaurar el contenido de la versión ${v.version}?`))
                        if (
                          await run(() =>
                            request(`/records/${r.id}/revisions`, 'POST', {
                              version: r.version,
                              revision: v.version,
                            }),
                          )
                        )
                          refresh();
                    }}
                  >
                    <Undo2 size={14} />
                    Restaurar
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
function FragmentCard({
  fragment: f,
  characters,
  save,
}: {
  fragment: Row;
  characters: Row[];
  save: (p: Row) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [source, setSource] = useState('recibió');
  return (
    <section className="fragment-card">
      <div className="section-title">
        <h3>{f.title}</h3>
        <span className="tag">{f.grants.length ? 'Revelado' : 'Privado'}</span>
      </div>
      <p className="preserve">{f.body}</p>
      <p className="muted">
        Acceso actual:{' '}
        {f.grants
          .map((g: Row) => characters.find((c) => c.id === g.character_id)?.title ?? 'Personaje')
          .join(', ') || 'Ningún personaje'}
      </p>
      {f.grants.some((g: Row) => g.opened_at) && (
        <p className="quiet-note">
          Hay aperturas registradas; esto no confirma que lo hayan leído.
        </p>
      )}
      <fieldset>
        <legend>Destinatarios de esta acción</legend>
        {characters.map((c) => (
          <label className="checkbox" key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id),
                )
              }
            />
            {c.title}
          </label>
        ))}
      </fieldset>
      <Field label="Cómo recibió este conocimiento">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {['recibió', 'presenció', 'le contaron', 'leyó'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <button
          className="button danger"
          disabled={!selected.length}
          onClick={() => save({ characters: selected, source, revoke: true })}
        >
          Retirar acceso
        </button>
        <button
          className="button primary"
          disabled={!selected.length}
          onClick={() => save({ characters: selected, source })}
        >
          <Eye size={15} />
          Revelar a {selected.length || '…'}
        </button>
      </div>
    </section>
  );
}
function FolderModal({
  folders,
  selected,
  close,
  save,
}: {
  folders: Row[];
  selected?: Row;
  close: () => void;
  save: (p: Row) => Promise<void>;
}) {
  const [name, setName] = useState(selected?.name ?? ''),
    [parent, setParent] = useState(selected?.parent_id ?? '');
  return (
    <Modal title={selected ? 'Editar carpeta' : 'Nueva carpeta'} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ name, parent_id: parent || null });
        }}
      >
        <Field label="Nombre">
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Carpeta superior">
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Raíz del archivo</option>
            {folders
              .filter((f) => f.id !== selected?.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </Field>
        <p className="notice">Renombrar o mover carpetas nunca publica su contenido.</p>
        <button className="button primary">Guardar carpeta</button>
      </form>
    </Modal>
  );
}
function SettingsPanel({
  data,
  request,
  run,
  base,
}: {
  data: Row;
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (a: () => Promise<unknown>, m?: string) => Promise<boolean>;
  base: string;
}) {
  const [link, setLink] = useState('');
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('player');
  return (
    <>
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Invitar con un enlace</h2>
          <p>
            Compartí este enlace con tus jugadores. Cada uno ingresa su propio correo, confirma el
            acceso y elige un personaje una sola vez. No necesitás registrar sus correos.
          </p>
          <button
            className="button primary"
            onClick={() =>
              run(async () => {
                const result = await request('/join-link', 'POST', {});
                setLink(window.location.origin + result.path);
              })
            }
          >
            Obtener enlace para jugadores
          </button>
          {link && (
            <>
              <Field label="Enlace para compartir">
                <input readOnly value={link} onFocus={(e) => e.target.select()} />
              </Field>
              <button
                className="button"
                onClick={() => run(() => navigator.clipboard.writeText(link), 'Enlace copiado')}
              >
                Copiar enlace
              </button>
              <button
                className="button"
                onClick={() =>
                  run(async () => {
                    const result = await request('/join-link', 'POST', { renew: true });
                    setLink(window.location.origin + result.path);
                  }, 'Enlace renovado. El anterior ya no admite nuevas solicitudes.')
                }
              >
                Renovar enlace
              </button>
            </>
          )}
          <p className="muted">
            Válido por 30 días. Quien reciba el enlace puede entrar como jugador. Renovarlo no
            elimina miembros ni accesos ya solicitados.
          </p>
          <h3 className="spaced">Invitación individual opcional</h3>
          <p className="muted">
            La invitación habilita el correo durante 7 días. No se envía ningún mensaje al crearla.
            Compartí personalmente la dirección de acceso.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  () => request('/invitations', 'POST', { email, role }),
                  'Invitación registrada. Compartí la dirección de acceso personalmente.',
                )
              )
                setEmail('');
            }}
          >
            <Field label="Correo real del invitado">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Rol en esta campaña">
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="player">Jugador</option>
                <option value="master">Máster (acceso completo)</option>
              </select>
            </Field>
            <button className="button primary">
              <Plus size={15} />
              Registrar invitación
            </button>
          </form>
          <h3 className="spaced">Invitaciones</h3>
          {data.invitations.map((i: Row) => (
            <div key={i.id} className="invitation">
              <strong>{i.email}</strong>
              <small>
                {i.accepted_at ? 'Aceptada' : `Vence: ${date(i.expires)}`} ·{' '}
                {i.role === 'master' ? 'Máster' : 'Jugador'}
              </small>
            </div>
          ))}
        </section>
        <section className="panel padded">
          <h2>Accesos individuales</h2>
          <p className="muted">
            Desactivar revoca el acceso en cada solicitud, incluso con una sesión abierta. Los
            personajes y su historia se conservan.
          </p>
          {data.members.map((m: Row) => (
            <div className="member-row" key={m.id}>
              <span>
                <strong>{m.name ?? m.email}</strong>
                <small>
                  {m.role === 'master' ? 'Máster' : 'Jugador'} ·{' '}
                  {m.active ? 'Activo' : 'Desactivado'}
                </small>
              </span>
              <button
                className="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `${m.active ? 'Desactivar' : 'Activar'} el acceso de ${m.email}?`,
                    )
                  )
                    run(() => request(`/members/${m.id}`, 'PATCH', { active: !m.active }));
                }}
              >
                {m.active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          ))}
          <h3 className="spaced">Respaldo completo</h3>
          <p className="muted">
            Incluye los datos a los que tenés acceso, archivos originales, relaciones e historial.
            Los borradores privados de jugadores quedan excluidos. Guardalo en un lugar cifrado y
            seguro. La restauración se ejecuta en una base aislada mediante el comando documentado.
          </p>
          <a className="button" href={`${base}/export`} download>
            <Download size={16} />
            Exportar datos accesibles
          </a>
        </section>
      </div>
      <StoragePanel request={request} run={run} />
      <IntegrationPanel request={request} run={run} />
    </>
  );
}
function DicePanel({
  data,
  request,
  run,
  readOnly,
}: {
  data: Row;
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (a: () => Promise<unknown>, m?: string) => Promise<boolean>;
  readOnly: boolean;
}) {
  const [formula, setFormula] = useState('1d20'),
    [mode, setMode] = useState('normal'),
    [result, setResult] = useState<Row | null>(null);
  return (
    <div className="dice-layout">
      <section className="panel padded">
        <h2>Que hablen los dados.</h2>
        <p className="muted">Tiradas privadas generadas y registradas en el servidor.</p>
        <div className="dice-buttons">
          {[4, 6, 8, 10, 12, 20, 100].map((d) => (
            <button
              className={`button ${formula === `1d${d}` ? 'selected' : ''}`}
              onClick={() => {
                setFormula(`1d${d}`);
                setMode('normal');
              }}
              key={d}
            >
              d{d}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setResult(await request('/rolls', 'POST', { formula, mode }));
            }, 'Tirada registrada en tu historial privado');
          }}
        >
          <Field label="Fórmula">
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              required
              maxLength={30}
              placeholder="2d6+3"
            />
          </Field>
          <Field label="Modo">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="ventaja">Ventaja (1d20)</option>
              <option value="desventaja">Desventaja (1d20)</option>
            </select>
          </Field>
          <button disabled={readOnly} className="button primary">
            <Dices size={17} />
            Tirar dados
          </button>
        </form>
        {result && (
          <div className="dice-result" role="status">
            <strong>{result.total}</strong>
            <span>
              {result.formula} · [{result.dice.join(', ')}] {result.modifier >= 0 ? '+' : ''}
              {result.modifier} · {result.mode}
            </span>
          </div>
        )}
      </section>
      <section className="panel padded">
        <h2>Tu historial</h2>
        {data.rolls.map((r: Row) => (
          <div className="roll-row" key={r.id}>
            <span>
              {r.data.formula}
              <small>
                {date(r.created_at)} · {r.data.mode}
              </small>
            </span>
            <strong>{r.data.total}</strong>
            <span className="muted">[{r.data.dice.join(', ')}]</span>
          </div>
        ))}
        {!data.rolls.length && <Empty text="Tu primera tirada todavía está por llegar." />}
      </section>
    </div>
  );
}

function useDialog(close: () => void) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const elements = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = elements[elements.length - 1];
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const focusable = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
        (e) => e.offsetParent !== null,
      );
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
}
