'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Lock, Mail, Send, Feather, ChevronRight } from 'lucide-react';
type R = Record<string, any>;
type Props = {
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  run: (a: () => Promise<unknown>, m?: string) => Promise<boolean>;
  characters: R[];
  master: boolean;
  readOnly: boolean;
  knownCharacters?: R[];
};
export function JournalPanel({ request, run, characters, readOnly, knownCharacters = [] }: Props) {
  const [list, setList] = useState<R[]>([]),
    [error, setError] = useState(''),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<R | null>(null);
  const load = useCallback(
    () =>
      request('/journals')
        .then(setList)
        .catch((e) => setError(e.message)),
    [request],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="panel padded">
      <div className="section-title compact">
        <h2>La memoria de tu personaje</h2>
        {!readOnly && characters.length > 0 && (
          <button className="button" onClick={() => setCreating(true)}>
            <Plus size={15} />
            Escribir
          </button>
        )}
      </div>
      <p className="muted">
        Tus borradores son privados. Compartir es una acción explícita y tus interpretaciones no
        cambian el canon.
      </p>
      {error && <p className="error">{error}</p>}
      {creating && (
        <JournalForm
          characters={characters}
          save={async (p) => {
            if (await run(() => request('/journals', 'POST', p), 'Borrador privado guardado')) {
              setCreating(false);
              load();
            }
          }}
          close={() => setCreating(false)}
        />
      )}
      {list.map((j) => (
        <article className="journal-card" key={j.id}>
          <div className="section-title compact">
            <h3>{j.title}</h3>
            <span className="tag">
              {j.type} · {j.shared_master ? 'Compartido con máster' : 'Privado / destinatarios'}
            </span>
          </div>
          <p className="preserve">{j.body}</p>
          {j.significance && (
            <p>
              <strong>Por qué fue significativo: </strong>
              {j.significance}
            </p>
          )}
          {j.change_text && (
            <p>
              <strong>Qué cambió: </strong>
              {j.change_text}
            </p>
          )}
          {j.explore && (
            <p>
              <strong>Quiero explorar: </strong>
              {j.explore}
            </p>
          )}
          {!readOnly && j.can_edit && (
            <button className="button" onClick={() => setEditing(j)}>
              Editar / compartir
            </button>
          )}
        </article>
      ))}
      {!list.length && (
        <p className="empty">
          Todavía no hay relatos compartidos ni borradores propios. Escribir es voluntario.
        </p>
      )}
      {editing && (
        <JournalEdit
          journal={editing}
          characters={knownCharacters}
          close={() => setEditing(null)}
          save={async (p) => {
            if (await run(() => request(`/journals/${editing.id}`, 'PATCH', p))) {
              setEditing(null);
              load();
            }
          }}
        />
      )}
    </section>
  );
}
function JournalForm({
  characters,
  save,
  close,
}: {
  characters: R[];
  save: (p: R) => Promise<void>;
  close: () => void;
}) {
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [type, setType] = useState('bitácora'),
    [char, setChar] = useState(characters[0]?.id ?? ''),
    [extra, setExtra] = useState<R>({});
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        save({ title, body, type, character_id: char, ...extra });
      }}
    >
      <label>
        Personaje
        <select value={char} onChange={(e) => setChar(e.target.value)}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tipo de relato
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {['bitácora', 'momento', 'intención'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Título del relato
        <input required maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Tu relato
        <textarea
          required
          rows={5}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {type === 'momento' &&
        [
          ['significance', 'Por qué fue significativo'],
          ['change_text', 'Qué cambió'],
          ['explore', 'Qué deseo explorar'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              rows={2}
              maxLength={5000}
              value={extra[key] ?? ''}
              onChange={(e) => setExtra({ ...extra, [key]: e.target.value })}
            />
          </label>
        ))}
      <div className="form-actions">
        <button type="button" className="button" onClick={close}>
          Cancelar
        </button>
        <button className="button primary">
          <Lock size={14} />
          Guardar borrador privado
        </button>
      </div>
    </form>
  );
}
function JournalEdit({
  journal: j,
  characters,
  save,
  close,
}: {
  journal: R;
  characters: R[];
  save: (p: R) => Promise<void>;
  close: () => void;
}) {
  const [title, setTitle] = useState(j.title),
    [body, setBody] = useState(j.body),
    [share, setShare] = useState(j.shared_master),
    [recipients, setRecipients] = useState<string[]>(j.recipients ?? []);
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        save({ version: j.version, title, body, shared_master: share, recipients });
      }}
    >
      <h3>Editar y elegir destinatarios</h3>
      <p className="muted">
        Solo el autor puede guardar cambios. Esta selección reemplaza los destinatarios anteriores.
      </p>
      <label>
        Título
        <input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} />
      </label>
      <label>
        Texto
        <textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={20000}
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Compartir con el máster
      </label>
      <fieldset>
        <legend>Otros personajes conocidos</legend>
        {characters.map((c) => (
          <label className="checkbox" key={c.id}>
            <input
              type="checkbox"
              checked={recipients.includes(c.id)}
              onChange={(e) =>
                setRecipients(
                  e.target.checked ? [...recipients, c.id] : recipients.filter((id) => id !== c.id),
                )
              }
            />
            {c.title}
          </label>
        ))}
        {!characters.length && (
          <p className="muted">No hay otros personajes conocidos disponibles.</p>
        )}
      </fieldset>
      <div className="form-actions">
        <button className="button" type="button" onClick={close}>
          Cancelar
        </button>
        <button className="button primary">Guardar y aplicar destinatarios</button>
      </div>
    </form>
  );
}
export function CorrespondencePanel({ request, run, characters, master, readOnly }: Props) {
  const [list, setList] = useState<R[]>([]),
    [selected, setSelected] = useState<R | null>(null),
    [create, setCreate] = useState(false),
    [error, setError] = useState(''),
    [reply, setReply] = useState('');
  const load = useCallback(
    () =>
      request('/threads')
        .then(setList)
        .catch((e) => setError(e.message)),
    [request],
  );
  useEffect(() => {
    load();
    setSelected(null);
  }, [load]);
  async function open(id: string) {
    if (
      await run(async () => {
        setSelected(await request(`/threads/${id}`));
      }, 'Conversación abierta')
    )
      load();
  }
  return (
    <section className="panel padded">
      <div className="section-title compact">
        <h2>Correspondencia privada</h2>
        {master && (
          <button className="button" onClick={() => setCreate(true)}>
            <Plus size={15} />
            Escribir mensaje
          </button>
        )}
      </div>
      <p className="muted">
        Solo el máster y el personaje destinatario acceden a cada conversación. No se envían
        notificaciones externas.
      </p>
      {error && <p className="error">{error}</p>}
      {create && (
        <ThreadForm
          characters={characters}
          close={() => setCreate(false)}
          save={async (p) => {
            if (
              await run(
                () => request('/threads', 'POST', p),
                p.send ? 'Mensaje enviado dentro de la campaña' : 'Borrador guardado',
              )
            ) {
              setCreate(false);
              load();
            }
          }}
        />
      )}
      <div className="thread-layout">
        <div>
          {list.map((t) => (
            <button
              className={`thread-row ${selected?.id === t.id ? 'selected' : ''}`}
              onClick={() => open(t.id)}
              key={t.id}
            >
              <Mail size={17} />
              <span>
                <strong>{t.title}</strong>
                <small>
                  {t.visible_sender}
                  {!t.sent_at ? ' · Borrador' : ''}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!list.length && <p className="empty">No hay correspondencia disponible.</p>}
        </div>
        {selected && (
          <article className="conversation">
            <h2>{selected.title}</h2>
            <p className="muted">De: {selected.visible_sender}</p>
            {master && selected.real_sender && (
              <p className="notice">Remitente real privado: {selected.real_sender}</p>
            )}
            {selected.messages.map((m: R) => (
              <section className={`message-bubble ${m.from_master ? '' : 'reply'}`} key={m.id}>
                <small>
                  {m.from_master ? selected.visible_sender : 'Respuesta del destinatario'}
                  {master && m.opened_at ? ' · Apertura registrada' : ''}
                </small>
                <p className="preserve">{m.body}</p>
              </section>
            ))}
            {master && !selected.sent_at && (
              <button
                className="button primary"
                onClick={async () => {
                  if (
                    await run(
                      () => request(`/threads/${selected.id}/send`, 'POST', {}),
                      'Correspondencia enviada al personaje',
                    )
                  ) {
                    load();
                    open(selected.id);
                  }
                }}
              >
                <Send size={15} />
                Enviar al destinatario
              </button>
            )}
            {selected.sent_at && (master || selected.replies_enabled) && !readOnly && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(
                      () => request(`/threads/${selected.id}/reply`, 'POST', { body: reply }),
                      'Respuesta guardada',
                    )
                  ) {
                    setReply('');
                    open(selected.id);
                  }
                }}
              >
                <label>
                  Respuesta
                  <textarea
                    required
                    maxLength={20000}
                    rows={4}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <button className="button primary">Enviar respuesta</button>
              </form>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
function ThreadForm({
  characters,
  save,
  close,
}: {
  characters: R[];
  save: (p: R) => Promise<void>;
  close: () => void;
}) {
  const [p, setP] = useState<R>({
    character_id: characters[0]?.id ?? '',
    title: '',
    visible_sender: '',
    real_sender: '',
    body: '',
    replies_enabled: false,
  });
  const setField = (k: string, v: any) => setP((s) => ({ ...s, [k]: v }));
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        save({ ...p, send: false });
      }}
    >
      <label>
        Personaje destinatario
        <select
          required
          value={p.character_id}
          onChange={(e) => setField('character_id', e.target.value)}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {[
        ['title', 'Asunto'],
        ['visible_sender', 'Identidad visible del remitente'],
        ['real_sender', 'Remitente real (privado)'],
      ].map(([k, label]) => (
        <label key={k}>
          {label}
          <input
            maxLength={180}
            required={k !== 'real_sender'}
            value={p[k]}
            onChange={(e) => setField(k, e.target.value)}
          />
        </label>
      ))}
      <label>
        Mensaje
        <textarea
          required
          rows={5}
          maxLength={20000}
          value={p.body}
          onChange={(e) => setField('body', e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={p.replies_enabled}
          onChange={(e) => setField('replies_enabled', e.target.checked)}
        />
        Permitir respuestas del personaje
      </label>
      <div className="form-actions">
        <button type="button" className="button" onClick={close}>
          Cancelar
        </button>
        <button className="button primary">Guardar borrador</button>
      </div>
    </form>
  );
}
