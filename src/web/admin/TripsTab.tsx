import { useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { api } from '../api.ts';
import { PHYSICAL_LABEL } from '../search/format.ts';
import {
  isBookable,
  MOODS,
  PHYSICAL,
  SALES_STATUSES,
  type CatalogMeta,
  type Faq,
  type ItineraryDay,
  type SalesStatus,
  type Tour,
  type Trip,
} from '../../shared/types.ts';
import { Alert, Field, RawDocument, rowClick, useAction, useLoad, type TabProps } from './ui.tsx';

type Row = { trip: Trip; bookable: number; from: number | null };
type SortKey = 'id' | 'title' | 'continent' | 'destination' | 'days' | 'bookable' | 'from' | 'rating';
type Sort = { key: SortKey; dir: 1 | -1 };

const COLUMNS: { key: SortKey; label: string; num?: boolean; value: (r: Row) => string | number | null }[] = [
  { key: 'id', label: 'ID', num: true, value: (r) => r.trip.id },
  { key: 'title', label: 'Title', value: (r) => r.trip.title },
  { key: 'continent', label: 'Continent', value: (r) => r.trip.continent },
  { key: 'destination', label: 'Destination', value: (r) => r.trip.destination },
  { key: 'days', label: 'Days', num: true, value: (r) => r.trip.numberOfDays },
  { key: 'bookable', label: 'Bookable dep.', num: true, value: (r) => r.bookable },
  { key: 'from', label: 'From', num: true, value: (r) => r.from },
  { key: 'rating', label: 'Rating', num: true, value: (r) => r.trip.rating?.value ?? null },
];

/** Empty values (no price, no rating) go last whichever the direction. */
function compare(a: string | number | null, b: string | number | null, dir: 1 | -1) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return dir * (typeof a === 'string' ? a.localeCompare(String(b)) : a - (b as number));
}

export function TripsTab({ meta, selected, select, reloadMeta }: TabProps) {
  const [q, setQ] = useState('');
  const [place, setPlace] = useState(''); // '', 'continent:Europe' or 'country:Italy'
  const [bookableFilter, setBookableFilter] = useState<'' | 'yes' | 'no'>('');
  const [sort, setSort] = useState<Sort | null>(null);
  const trips = useLoad(() => api.admin.trips(q.trim() || undefined), [q], q ? 250 : 0);

  if (selected) {
    const close = (changed: boolean) => {
      select(null);
      if (changed) {
        trips.reload();
        reloadMeta();
      }
    };
    return <TripEditor key={selected} id={selected === 'new' ? null : Number(selected)} meta={meta} close={close} />;
  }

  const [placeKind, placeName] = place.split(':');
  const rows = (trips.data ?? [])
    .filter((t) => !place || (placeKind === 'continent' ? t.continent : t.destination) === placeName)
    .map((trip): Row => {
      const bookable = trip.tours.filter((d) => isBookable(d, meta.today));
      return { trip, bookable: bookable.length, from: bookable.length ? Math.min(...bookable.map((d) => d.priceEur)) : null };
    })
    .filter((r) => !bookableFilter || (r.bookable > 0) === (bookableFilter === 'yes'));
  const column = COLUMNS.find((c) => c.key === sort?.key);
  // Non-bookable trips always go last: they are invisible to visitors, so they matter least here.
  // (Array.sort is stable, so the column sort is kept inside each group.)
  if (sort && column) rows.sort((a, b) => compare(column.value(a), column.value(b), sort.dir));
  rows.sort((a, b) => Number(b.bookable > 0) - Number(a.bookable > 0));
  const filtered = q || place || bookableFilter || sort;
  const resetFilters = () => (setQ(''), setPlace(''), setBookableFilter(''), setSort(null));
  const byContinent = Map.groupBy(meta.destinations, (d) => d.continent);

  return (
    <>
      <div className="adm-filters">
        <Field label="Search trips">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="title, destination, continent" />
        </Field>
        <Field label="Continent / country">
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">All</option>
            {[...byContinent.keys()].sort().map((continent) => (
              <optgroup key={continent} label={continent}>
                <option value={`continent:${continent}`}>All of {continent}</option>
                {byContinent
                  .get(continent)!
                  .map((d) => d.name)
                  .sort()
                  .map((name) => (
                    <option key={name} value={`country:${name}`}>
                      {name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Bookable">
          <select value={bookableFilter} onChange={(e) => setBookableFilter(e.target.value as typeof bookableFilter)}>
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <button type="button" className="adm-btn" onClick={resetFilters} disabled={!filtered}>
          Reset filters
        </button>
        <button className="adm-btn adm-btn--primary" onClick={() => select('new')}>
          New trip
        </button>
      </div>
      <Alert error={trips.error} />
      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={c.num ? 'adm-num' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="adm-sort" onClick={() => setSort({ key: c.key, dir: active && sort.dir === 1 ? -1 : 1 })}>
                      {c.label}
                      <span aria-hidden>{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ trip: t, bookable, from }) => (
              <tr key={t.id} className={bookable ? 'adm-row' : 'adm-row adm-row--off'} onClick={rowClick(() => select(t.id))}>
                <td className="adm-num">{t.id}</td>
                <td>
                  <a className="adm-rowlink" href={`#trips/${t.id}`}>
                    {t.title}
                  </a>
                  {!bookable && <span className="adm-tag adm-tag--off">Not bookable</span>}
                </td>
                <td>{t.continent}</td>
                <td>{t.destination}</td>
                <td className="adm-num">{t.numberOfDays}</td>
                <td className="adm-num" title={bookable ? undefined : 'No bookable departure: hidden from visitors'}>
                  <span className={bookable ? undefined : 'adm-error'}>
                    {bookable}/{t.tours.length}
                  </span>
                </td>
                <td className="adm-num adm-price">{from === null ? '—' : `€${from}`}</td>
                <td className="adm-num">{t.rating ? `★ ${t.rating.value} (${t.rating.count})` : '—'}</td>
              </tr>
            ))}
            {trips.data && !rows.length && (
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

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// A month out, so a new departure is bookable as soon as it has a price (one departing today never is).
const newTour = (today: string, numberOfDays: number): Tour => ({
  id: `new-${Date.now().toString(36)}`,
  startingDate: addDays(today, 30),
  endingDate: addDays(today, 30 + Math.max(1, numberOfDays || 1) - 1),
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

  const bookable = draft.tours.filter((t) => isBookable(t, meta.today)).length;

  return (
    <form className="adm-editor" onSubmit={save}>
      <div className="adm-head">
        <h2>{id === null ? 'New trip' : `Trip #${id}`}</h2>
        <div className="adm-actions adm-actions--links">
          {id !== null && <RawDocument load={() => api.admin.rawTrip(id)} title={`Trip #${id}`} note="as stored in Elasticsearch (embedding shortened)" />}
          {draft.url && (
            <a href={draft.url} target="_blank" rel="noreferrer">
              View on weroad.com ↗
            </a>
          )}
        </div>
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
        <div className="adm-profile">
          <Field label="Travel style">
            <input {...text('travelStyle')} />
          </Field>
          <Field label="Physical effort">
            <select {...text('physicalRating')}>
              {PHYSICAL.map((p) => (
                <option key={p} value={p}>
                  {PHYSICAL_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rating (0-5)">
            <input type="number" min={0} max={5} step={0.1} placeholder="none" {...text('ratingValue')} />
          </Field>
          <Field label="Reviews">
            <input type="number" min={0} step={1} placeholder="0" {...text('ratingCount')} />
          </Field>
          <Field label="Travel types (comma separated)" wide>
            <input {...text('travelTypes')} placeholder={meta.travelTypes.slice(0, 4).join(', ')} />
          </Field>
        </div>

        <div className="adm-moods">
          <h4>
            Moods <span className="adm-muted">· how strongly the trip delivers each vibe (0-100), used to rank vibe requests</span>
          </h4>
          <div className="adm-moods__grid">
            {MOODS.map((m) => (
              <label key={m} className="adm-mood">
                <span>{m}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.moods[m]}
                  style={{ '--fill': `${draft.moods[m]}%` } as CSSProperties}
                  onChange={(e) => set({ moods: { ...draft.moods, [m]: Number(e.target.value) } })}
                />
                <output>{draft.moods[m]}</output>
              </label>
            ))}
          </div>
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
                  today={meta.today}
                  onChange={(patch) => setTours((tours) => tours.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                  onRemove={() => setTours((tours) => tours.filter((_, j) => j !== i))}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-hint">Greyed rows (sold out, not bookable, no seats or already departed) are not shown to visitors.</p>
        <button type="button" className="adm-btn" onClick={() => setTours((tours) => [...tours, newTour(meta.today, draft.numberOfDays)])}>
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

function TourRow(props: { tour: Tour; today: string; onChange: (patch: Partial<Tour>) => void; onRemove: () => void }) {
  const { tour, today, onChange, onRemove } = props;
  const num = (k: 'priceEur' | 'seatsLeft' | 'maxPax' | 'paxBooked', min = 0) => (
    <input type="number" min={min} required value={tour[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) })} />
  );
  const flag = (k: 'isConfirmed' | 'privateRoomBookable' | 'isWomenOnly') => (
    <td className="adm-check">
      <input type="checkbox" checked={tour[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
    </td>
  );
  const visible = isBookable(tour, today);
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
      <td>{num('maxPax', 1)}</td>
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
