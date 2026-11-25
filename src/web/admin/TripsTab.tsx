import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api.ts';
import { MOODS, PHYSICAL, SALES_STATUSES, type CatalogMeta, type Faq, type ItineraryDay, type SalesStatus, type Tour, type Trip } from '../../shared/types.ts';
import { Alert, Field, isBookable, today, useAction, useLoad, type TabProps } from './ui.tsx';

export function TripsTab({ meta, selected, select }: TabProps) {
  const [q, setQ] = useState('');
  const trips = useLoad(() => api.admin.trips(q.trim() || undefined), [q], q ? 250 : 0);

  if (selected) {
    const close = (changed: boolean) => {
      select(null);
      if (changed) trips.reload();
    };
    return <TripEditor key={selected} id={selected === 'new' ? null : Number(selected)} meta={meta} close={close} />;
  }

  return (
    <>
      <div className="adm-filters">
        <Field label="Search trips">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="title, destination, continent" />
        </Field>
        <button className="adm-btn adm-btn--primary" onClick={() => select('new')}>
          New trip
        </button>
      </div>
      <Alert error={trips.error} />
      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th className="adm-num">ID</th>
              <th>Title</th>
              <th>Destination</th>
              <th>Continent</th>
              <th className="adm-num">Days</th>
              <th className="adm-num">Bookable dep.</th>
              <th className="adm-num">From</th>
              <th className="adm-num">Rating</th>
            </tr>
          </thead>
          <tbody>
            {trips.data?.map((t) => {
              const bookable = t.tours.filter(isBookable);
              return (
                <tr key={t.id} className="adm-row" onClick={() => select(t.id)}>
                  <td className="adm-num">{t.id}</td>
                  <td>{t.title}</td>
                  <td>{t.destination}</td>
                  <td>{t.continent}</td>
                  <td className="adm-num">{t.numberOfDays}</td>
                  <td className="adm-num" title={bookable.length ? undefined : 'No bookable departure: hidden from visitors'}>
                    <span className={bookable.length ? undefined : 'adm-error'}>
                      {bookable.length}/{t.tours.length}
                    </span>
                  </td>
                  <td className="adm-num adm-price">{bookable.length ? `€${Math.min(...bookable.map((d) => d.priceEur))}` : '—'}</td>
                  <td className="adm-num">{t.rating ? `★ ${t.rating.value} (${t.rating.count})` : '—'}</td>
                </tr>
              );
            })}
            {trips.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="adm-empty">
                  No trips found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Editor (create + edit) ----------

type NewTrip = Omit<Trip, 'id'>;

// Form state: lists and nullable values are edited as text and parsed on save; the itinerary is edited as rows.
type Draft = Omit<NewTrip, 'travelTypes' | 'shortDescription' | 'rating'> & {
  travelTypes: string;
  shortDescription: string;
  ratingValue: string;
  ratingCount: string;
};
type TextKey = { [K in keyof Draft]-?: Draft[K] extends string ? K : never }[keyof Draft];

const BLANK: NewTrip = {
  slug: '',
  url: '',
  title: '',
  destination: '',
  continent: '',
  destinationLabel: '',
  numberOfDays: 7,
  startingPlace: '',
  endingPlace: '',
  travelStyle: 'Classic',
  travelTypes: [],
  moods: { party: 50, relax: 50, nature: 50, culture: 50, history: 50 },
  physicalRating: 'MEDIUM',
  shortDescription: null,
  description: '',
  rating: null,
  itinerary: [],
  tours: [],
};

const newTour = (): Tour => ({
  id: `new-${Date.now().toString(36)}`,
  startingDate: today(),
  endingDate: today(),
  priceEur: 0,
  basePriceEur: null,
  salesStatus: 'PLANNED',
  isConfirmed: false,
  maxPax: 14,
  seatsLeft: 14,
  paxBooked: 0,
  privateRoomBookable: false,
  isWomenOnly: false,
  ageBand: '25-35',
});

const toDraft = ({ travelTypes, shortDescription, rating, ...rest }: NewTrip): Draft => ({
  ...rest,
  travelTypes: travelTypes.join(', '),
  shortDescription: shortDescription ?? '',
  ratingValue: rating ? String(rating.value) : '',
  ratingCount: rating ? String(rating.count) : '',
});

const fromDraft = ({ travelTypes, shortDescription, ratingValue, ratingCount, itinerary, ...rest }: Draft): NewTrip => ({
  ...rest,
  travelTypes: travelTypes.split(',').map((s) => s.trim()).filter(Boolean),
  shortDescription: shortDescription.trim() || null,
  rating: ratingValue === '' ? null : { value: Number(ratingValue), count: Number(ratingCount || 0) },
  // Days are numbered by position; blank highlight lines (kept while typing) are dropped on save.
  itinerary: itinerary.map((d, i) => ({
    day: i + 1,
    title: d.title.trim(),
    nights: d.nights?.trim() || null,
    highlights: d.highlights.map((h) => h.trim()).filter(Boolean),
  })),
});

function TripEditor({ id, meta, close }: { id: number | null; meta: CatalogMeta; close: (changed: boolean) => void }) {
  const trip = useLoad<NewTrip & { faqs: Faq[] }>(() => (id === null ? Promise.resolve({ ...BLANK, faqs: [] }) : api.admin.trip(id)), [id]);
  if (!trip.data)
    return (
      <>
        <Alert error={trip.error} />
        {trip.error ? (
          <button className="adm-btn" onClick={() => close(false)}>
            ‹ Back to trips
          </button>
        ) : (
          <p className="adm-muted">Loading…</p>
        )}
      </>
    );
  const { faqs, ...initial } = trip.data;
  return <TripForm id={id} initial={initial} faqs={faqs} meta={meta} close={close} />;
}

function TripForm({ id, initial, faqs, meta, close }: { id: number | null; initial: NewTrip; faqs: Faq[]; meta: CatalogMeta; close: (changed: boolean) => void }) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const action = useAction(() => close(true));

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const text = (k: TextKey) => ({
    value: draft[k],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set({ [k]: e.target.value }),
  });
  const setTours = (fn: (tours: Tour[]) => Tour[]) => setDraft((d) => ({ ...d, tours: fn(d.tours) }));
  const setDays = (fn: (days: ItineraryDay[]) => ItineraryDay[]) => setDraft((d) => ({ ...d, itinerary: fn(d.itinerary) }));
  // Picking a known destination fills in its continent.
  const setDestination = (destination: string) =>
    set({ destination, continent: meta.destinations.find((d) => d.name === destination)?.continent ?? draft.continent });

  const save = (e: FormEvent) => {
    e.preventDefault();
    action.run(() => {
      const trip = fromDraft(draft);
      return id === null ? api.admin.createTrip(trip) : api.admin.updateTrip({ ...trip, id });
    });
  };
  const remove = () => {
    if (id !== null && confirm(`Delete "${draft.title}"? This cannot be undone.`)) action.run(() => api.admin.deleteTrip(id));
  };

  const bookable = draft.tours.filter(isBookable).length;

  return (
    <form className="adm-editor" onSubmit={save}>
      <div className="adm-head">
        <h2>{id === null ? 'New trip' : `Trip #${id}`}</h2>
        {draft.url && (
          <a href={draft.url} target="_blank" rel="noreferrer">
            View on weroad.com ↗
          </a>
        )}
      </div>

      <section className="adm-card">
        <h3>Basics</h3>
        <div className="adm-form">
          <Field label="Title" wide>
            <input required {...text('title')} />
          </Field>
          <Field label="Slug">
            <input required {...text('slug')} />
          </Field>
          <Field label="URL">
            <input type="url" {...text('url')} />
          </Field>
          <Field label="Destination (country)">
            <input required list="adm-destinations" value={draft.destination} onChange={(e) => setDestination(e.target.value)} />
          </Field>
          <Field label="Continent">
            <input required list="adm-continents" {...text('continent')} />
          </Field>
          <Field label="Destination label">
            <input required {...text('destinationLabel')} />
          </Field>
          <Field label="Days">
            <input type="number" min={1} required value={draft.numberOfDays} onChange={(e) => set({ numberOfDays: Number(e.target.value) })} />
          </Field>
          <Field label="Starting place">
            <input {...text('startingPlace')} />
          </Field>
          <Field label="Ending place">
            <input {...text('endingPlace')} />
          </Field>
        </div>
      </section>

      <section className="adm-card">
        <h3>Profile</h3>
        <div className="adm-form">
          <Field label="Travel style">
            <input {...text('travelStyle')} />
          </Field>
          <Field label="Travel types (comma separated)" wide>
            <input {...text('travelTypes')} placeholder={meta.travelTypes.slice(0, 4).join(', ')} />
          </Field>
          <Field label="Physical effort">
            <select {...text('physicalRating')}>
              {PHYSICAL.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Rating (empty = none)">
            <input type="number" min={0} max={5} step={0.1} {...text('ratingValue')} />
          </Field>
          <Field label="Reviews">
            <input type="number" min={0} step={1} {...text('ratingCount')} />
          </Field>
        </div>
        <div className="adm-form adm-form--tight">
          {MOODS.map((m) => (
            <Field key={m} label={`Mood: ${m} (0-100)`}>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.moods[m]}
                onChange={(e) => set({ moods: { ...draft.moods, [m]: Number(e.target.value) } })}
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="adm-card">
        <h3>Description</h3>
        <div className="adm-form">
          <Field label="Short description" wide>
            <input {...text('shortDescription')} />
          </Field>
          <Field label="Description" wide>
            <textarea rows={6} {...text('description')} />
          </Field>
        </div>
      </section>

      <section className="adm-card">
        <h3>
          Departures <span className="adm-muted">{bookable} bookable of {draft.tours.length}</span>
        </h3>
        <div className="adm-scroll">
          <table className="adm-table adm-tours">
            <thead>
              <tr>
                <th>ID</th>
                <th>Start</th>
                <th>End</th>
                <th>Price €</th>
                <th>Base €</th>
                <th>Status</th>
                <th>Seats left</th>
                <th>Max pax</th>
                <th>Booked</th>
                <th>Age band</th>
                <th className="adm-check">Confirmed</th>
                <th className="adm-check">Private room</th>
                <th className="adm-check">Women only</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.tours.map((t, i) => (
                <TourRow
                  key={i}
                  tour={t}
                  onChange={(patch) => setTours((tours) => tours.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                  onRemove={() => setTours((tours) => tours.filter((_, j) => j !== i))}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-hint">Greyed rows (sold out, not bookable, no seats or already departed) are not shown to visitors.</p>
        <button type="button" className="adm-btn" onClick={() => setTours((tours) => [...tours, newTour()])}>
          + Add departure
        </button>
      </section>

      <section className="adm-card">
        <h3>
          Itinerary <span className="adm-muted">{draft.itinerary.length} days</span>
        </h3>
        <ItineraryEditor days={draft.itinerary} setDays={setDays} />
      </section>

      {id !== null && (
        <section className="adm-card">
          <h3>
            Related FAQs <span className="adm-muted">{draft.destination}</span>
          </h3>
          {faqs.length ? (
            <ul className="adm-list">
              {faqs.map((f) => (
                <li key={f.id}>
                  <a href={`#faqs/${f.id}`}>{f.title}</a> <span className="adm-tag">{f.scope}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-muted">No FAQs for this destination yet.</p>
          )}
        </section>
      )}

      <div className="adm-bar">
        <Alert error={action.error} />
        <button type="submit" className="adm-btn adm-btn--primary" disabled={action.busy}>
          {action.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="adm-btn" onClick={() => close(false)}>
          Cancel
        </button>
        {id !== null && (
          <button type="button" className="adm-btn adm-btn--danger" onClick={remove} disabled={action.busy}>
            Delete
          </button>
        )}
      </div>

      <datalist id="adm-destinations">
        {meta.destinations.map((d) => (
          <option key={d.name} value={d.name} />
        ))}
      </datalist>
      <datalist id="adm-continents">
        {meta.continents.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="adm-agebands">
        {meta.ageBands.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </form>
  );
}

function TourRow({ tour, onChange, onRemove }: { tour: Tour; onChange: (patch: Partial<Tour>) => void; onRemove: () => void }) {
  const num = (k: 'priceEur' | 'seatsLeft' | 'maxPax' | 'paxBooked') => (
    <input type="number" min={0} required value={tour[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) })} />
  );
  const flag = (k: 'isConfirmed' | 'privateRoomBookable' | 'isWomenOnly') => (
    <td className="adm-check">
      <input type="checkbox" checked={tour[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
    </td>
  );
  const visible = isBookable(tour);
  return (
    <tr className={visible ? undefined : 'adm-off'} title={visible ? undefined : 'Not shown to visitors'}>
      <td>
        <input required value={tour.id} onChange={(e) => onChange({ id: e.target.value })} />
      </td>
      <td>
        <input type="date" required value={tour.startingDate} onChange={(e) => onChange({ startingDate: e.target.value })} />
      </td>
      <td>
        <input type="date" required value={tour.endingDate} onChange={(e) => onChange({ endingDate: e.target.value })} />
      </td>
      <td>{num('priceEur')}</td>
      <td>
        <input
          type="number"
          min={0}
          value={tour.basePriceEur ?? ''}
          onChange={(e) => onChange({ basePriceEur: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </td>
      <td>
        <select value={tour.salesStatus} onChange={(e) => onChange({ salesStatus: e.target.value as SalesStatus })}>
          {SALES_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </td>
      <td>{num('seatsLeft')}</td>
      <td>{num('maxPax')}</td>
      <td>{num('paxBooked')}</td>
      <td>
        <input required list="adm-agebands" value={tour.ageBand} onChange={(e) => onChange({ ageBand: e.target.value })} />
      </td>
      {flag('isConfirmed')}
      {flag('privateRoomBookable')}
      {flag('isWomenOnly')}
      <td>
        <button type="button" className="adm-btn adm-btn--icon" onClick={onRemove} aria-label="Remove departure">
          ×
        </button>
      </td>
    </tr>
  );
}

/** One row per day: title, where the group sleeps, highlights one per line. Day numbers follow the row order. */
function ItineraryEditor({ days, setDays }: { days: ItineraryDay[]; setDays: (fn: (days: ItineraryDay[]) => ItineraryDay[]) => void }) {
  const update = (i: number, patch: Partial<ItineraryDay>) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) =>
    setDays((ds) => {
      const next = [...ds];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  return (
    <>
      <div className="adm-scroll">
        <table className="adm-table adm-days">
          <thead>
            <tr>
              <th className="adm-num">Day</th>
              <th>Title</th>
              <th>Overnight in</th>
              <th>Highlights (one per line)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={i}>
                <td className="adm-num">{i + 1}</td>
                <td>
                  <input required value={d.title} onChange={(e) => update(i, { title: e.target.value })} />
                </td>
                <td>
                  <input value={d.nights ?? ''} placeholder="— (last day)" onChange={(e) => update(i, { nights: e.target.value })} />
                </td>
                <td>
                  <textarea rows={Math.max(2, d.highlights.length)} value={d.highlights.join('\n')} onChange={(e) => update(i, { highlights: e.target.value.split('\n') })} />
                </td>
                <td className="adm-nowrap">
                  <button type="button" className="adm-btn adm-btn--icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move day up">
                    ↑
                  </button>
                  <button type="button" className="adm-btn adm-btn--icon" onClick={() => move(i, 1)} disabled={i === days.length - 1} aria-label="Move day down">
                    ↓
                  </button>
                  <button type="button" className="adm-btn adm-btn--icon" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))} aria-label="Remove day">
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {!days.length && (
              <tr>
                <td colSpan={5} className="adm-empty">
                  No days yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="adm-btn" onClick={() => setDays((ds) => [...ds, { day: ds.length + 1, title: '', nights: null, highlights: [] }])}>
        + Add day
      </button>
    </>
  );
}
