import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import type { CatalogMeta, Faq, Trip } from '../../shared/types.ts';
import { Alert, Field, RawDocument, rowClick, useAction, useLoad, type TabProps } from './ui.tsx';

const GENERAL = '__general';
const BLANK: Omit<Faq, 'id'> = { scope: 'general', destination: null, title: '', body: '', url: null };

// All FAQs are loaded once (~50) and filtered here, so "General" works and #faqs/<id> can open any FAQ.
export function FaqsTab({ meta, selected, select }: TabProps) {
  const faqs = useLoad(() => api.admin.faqs(), []);
  const trips = useLoad(() => api.admin.trips(), []); // to show which trips each FAQ is linked to
  const [filter, setFilter] = useState('');

  if (selected) {
    const faq = selected === 'new' ? null : faqs.data?.find((f) => f.id === Number(selected));
    if (faq === undefined) return faqs.data ? <Alert error={`FAQ #${selected} not found.`} /> : <p className="adm-muted">Loading…</p>;
    const close = (changed: boolean) => {
      select(null);
      if (changed) faqs.reload();
    };
    return <FaqEditor key={selected} faq={faq} meta={meta} trips={trips.data ?? []} close={close} />;
  }

  const shown = (faqs.data ?? []).filter((f) => !filter || (filter === GENERAL ? f.scope === 'general' : f.destination === filter));
  // The filter only offers destinations that have FAQs (the editor still lists every catalog destination).
  const counts = Map.groupBy(faqs.data ?? [], (f) => (f.scope === 'general' ? GENERAL : f.destination));
  const destinations = [...counts.keys()].filter((d): d is string => !!d && d !== GENERAL).sort();

  return (
    <>
      <div className="adm-filters">
        <Field label="Destination">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All ({faqs.data?.length ?? 0})</option>
            <option value={GENERAL}>General ({counts.get(GENERAL)?.length ?? 0})</option>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d} ({counts.get(d)!.length})
              </option>
            ))}
          </select>
        </Field>
        <button type="button" className="adm-btn" onClick={() => setFilter('')} disabled={!filter}>
          Reset filters
        </button>
        <button className="adm-btn adm-btn--primary" onClick={() => select('new')}>
          New FAQ
        </button>
      </div>
      <Alert error={faqs.error ?? trips.error} />
      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th className="adm-num">ID</th>
              <th>Scope</th>
              <th>Destination</th>
              <th>Title</th>
              <th className="adm-num">Linked trips</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const linked = trips.data?.filter((t) => t.destination === f.destination).length;
              return (
                <tr key={f.id} className="adm-row" onClick={rowClick(() => select(f.id))}>
                  <td className="adm-num">{f.id}</td>
                  <td>
                    <span className="adm-tag">{f.scope}</span>
                  </td>
                  <td>{f.destination ?? '—'}</td>
                  <td>
                    <a className="adm-rowlink" href={`#faqs/${f.id}`}>
                      {f.title}
                    </a>
                  </td>
                  <td className="adm-num">
                    {f.scope === 'general' ? (
                      'all'
                    ) : (
                      <span className={linked === 0 ? 'adm-error' : undefined} title={linked === 0 ? 'No trip has this destination' : undefined}>
                        {linked ?? '…'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {faqs.data && !shown.length && (
              <tr>
                <td colSpan={5} className="adm-empty">
                  No FAQs here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FaqEditor({ faq, meta, trips, close }: { faq: Faq | null; meta: CatalogMeta; trips: Trip[]; close: (changed: boolean) => void }) {
  const [draft, setDraft] = useState<Omit<Faq, 'id'>>(faq ?? BLANK);
  const action = useAction(() => close(true));
  const set = (patch: Partial<Faq>) => setDraft((d) => ({ ...d, ...patch }));
  const linked = draft.scope === 'destination' ? trips.filter((t) => t.destination === draft.destination) : [];
  // Keep the FAQ's own destination selectable even when no trip has it any more, so it can still be saved as is.
  const destinations = meta.destinations.map((d) => d.name);
  if (draft.destination && !destinations.includes(draft.destination)) destinations.unshift(draft.destination);

  const save = (e: FormEvent) => {
    e.preventDefault();
    action.run(() => (faq ? api.admin.updateFaq({ ...draft, id: faq.id }) : api.admin.createFaq(draft)));
  };
  const remove = () => {
    if (faq && confirm(`Delete "${faq.title}"? This cannot be undone.`)) action.run(() => api.admin.deleteFaq(faq.id));
  };

  return (
    <form className="adm-editor" onSubmit={save}>
      <div className="adm-head">
        <h2>{faq ? `FAQ #${faq.id}` : 'New FAQ'}</h2>
        {faq && <RawDocument load={() => api.admin.rawFaq(faq.id)} title={`FAQ #${faq.id}`} note="as stored in Elasticsearch (embedding shortened)" />}
      </div>

      <section className="adm-card">
        <div className="adm-form">
          <Field label="Title" wide>
            <input required value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Scope">
            <select
              value={draft.scope}
              onChange={(e) => {
                const scope = e.target.value as Faq['scope'];
                set({ scope, destination: scope === 'general' ? null : draft.destination });
              }}
            >
              <option value="general">general</option>
              <option value="destination">destination</option>
            </select>
          </Field>
          <Field label="Destination">
            <select
              value={draft.destination ?? ''}
              required={draft.scope === 'destination'}
              disabled={draft.scope === 'general'}
              onChange={(e) => set({ destination: e.target.value || null })}
            >
              <option value="">{draft.scope === 'general' ? 'all trips' : 'choose…'}</option>
              {destinations.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input type="url" value={draft.url ?? ''} onChange={(e) => set({ url: e.target.value || null })} />
          </Field>
          <Field label="Body" wide>
            <textarea required rows={10} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="adm-card">
        <h3>Linked trips</h3>
        {draft.scope === 'general' ? (
          <p className="adm-muted">General FAQ: applies to every trip.</p>
        ) : linked.length ? (
          <ul className="adm-list">
            {linked.map((t) => (
              <li key={t.id}>
                <a href={`#trips/${t.id}`}>{t.title}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-muted">No trip has this destination.</p>
        )}
      </section>

      <div className="adm-bar">
        <Alert error={action.error} />
        <button type="submit" className="adm-btn adm-btn--primary" disabled={action.busy}>
          {action.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="adm-btn" onClick={() => close(false)}>
          Cancel
        </button>
        {faq && (
          <button type="button" className="adm-btn adm-btn--danger" onClick={remove} disabled={action.busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
