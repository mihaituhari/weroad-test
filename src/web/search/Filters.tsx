import { useEffect, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { PHYSICAL, type CatalogMeta, type Physical, type SearchState } from '../../shared/types.ts';
import { chips, money, patch, PHYSICAL_LABEL } from './format.ts';

type OnChange = (next: SearchState) => void;

const str = (f: FormData, key: string) => String(f.get(key) ?? '').trim() || undefined;
const num = (f: FormData, key: string) => (str(f, key) ? Number(str(f, key)) : undefined);

/** Search-bar values typed but not searched yet; SearchPage merges them into every search. */
export type BarEdits = Partial<Record<'text' | 'departFrom' | 'departTo', string>>;

/** "Where / what?" + "When?" in one bordered box, like weroad.com. */
export function SearchBar(props: { state: SearchState; edits: BarEdits; onEdit: (edits: BarEdits) => void; onSearch: () => void }) {
  const { state, edits, onEdit, onSearch } = props;
  const field = (key: keyof BarEdits) => ({
    name: key,
    value: edits[key] ?? state[key] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement>) => onEdit({ [key]: e.target.value }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSearch();
  }
  return (
    <form className="searchbar" onSubmit={submit}>
      <label className="searchbar__field searchbar__where">
        <span>Where / what?</span>
        <input {...field('text')} placeholder="Japan, northern lights, hiking…" />
      </label>
      <label className="searchbar__field">
        <span>When? From</span>
        <input type="date" {...field('departFrom')} />
      </label>
      <label className="searchbar__field">
        <span>To</span>
        <input type="date" {...field('departTo')} />
      </label>
      <button className="btn btn--primary">Search</button>
    </form>
  );
}

export function FilterBar({ state, meta, onChange }: { state: SearchState; meta: CatalogMeta | null; onChange: OnChange }) {
  useCloseOnOutsideClick();
  const set = (changes: SearchState) => onChange(patch(state, changes));
  const count = (values?: unknown[]) => (values?.length ? String(values.length) : undefined);
  const { durationMin: dMin, durationMax: dMax } = state;
  const more = [state.womenOnly, state.privateRoom, state.confirmedOnly, state.minSeats].filter(Boolean);

  return (
    <div className="filterbar">
      <Pill label="Budget" value={state.budgetMax && `≤ ${money(state.budgetMax)}`}>
        <ApplyForm key={state.budgetMax} onApply={(f) => set({ budgetMax: num(f, 'budgetMax') })}>
          <label className="field">
            Max price per person (€)
            <input type="number" name="budgetMax" min={0} step={50} defaultValue={state.budgetMax} placeholder={meta ? String(meta.priceRange[1]) : ''} />
          </label>
        </ApplyForm>
      </Pill>

      <Pill label="Duration" value={dMin && dMax ? `${dMin}–${dMax} days` : dMin ? `${dMin}+ days` : dMax && `≤ ${dMax} days`}>
        <ApplyForm key={`${dMin}-${dMax}`} onApply={(f) => set({ durationMin: num(f, 'min'), durationMax: num(f, 'max') })}>
          <div className="row">
            <label className="field">
              Min days
              <input type="number" name="min" min={1} defaultValue={dMin} placeholder={String(meta?.durationRange[0] ?? '')} />
            </label>
            <label className="field">
              Max days
              <input type="number" name="max" min={1} defaultValue={dMax} placeholder={String(meta?.durationRange[1] ?? '')} />
            </label>
          </div>
        </ApplyForm>
      </Pill>

      <Pill label="Physical effort" value={count(state.physical)}>
        <CheckList options={[...PHYSICAL]} label={(v) => PHYSICAL_LABEL[v as Physical]} selected={state.physical} onChange={(v) => set({ physical: v as Physical[] })} />
      </Pill>
      <Pill label="Trip type" value={count(state.travelTypes)}>
        <CheckList options={meta?.travelTypes} selected={state.travelTypes} onChange={(v) => set({ travelTypes: v })} />
      </Pill>
      <Pill label="Continent" value={count(state.continents)}>
        <CheckList options={meta?.continents} selected={state.continents} onChange={(v) => set({ continents: v })} />
      </Pill>
      <Pill label="Destination" value={count(state.destinations)}>
        <CheckList options={meta?.destinations.map((d) => d.name).sort()} selected={state.destinations} onChange={(v) => set({ destinations: v })} />
      </Pill>
      <Pill label="Age range" value={count(state.ageBands)}>
        <CheckList options={meta?.ageBands} selected={state.ageBands} onChange={(v) => set({ ageBands: v })} />
      </Pill>

      <Pill label="More" value={count(more)}>
        <div className="stack">
          {(
            [
              ['womenOnly', 'Women only'],
              ['privateRoom', 'Private room'],
              ['confirmedOnly', 'Confirmed departures only'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={!!state[key]} onChange={(e) => set({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <label className="field">
            Group size (seats together)
            <select value={state.minSeats ?? ''} onChange={(e) => set({ minSeats: Number(e.target.value) || undefined })}>
              <option value="">Any</option>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} people
                </option>
              ))}
            </select>
          </label>
        </div>
      </Pill>
    </div>
  );
}

/** Every applied field as a removable chip. */
export function Chips({ state, onChange }: { state: SearchState; onChange: OnChange }) {
  const list = chips(state);
  if (!list.length) return null;
  return (
    <div className="chips">
      {list.map((c) => (
        <button key={c.id} type="button" className="chip" onClick={() => onChange(c.next)} aria-label={`Remove ${c.label}`}>
          {c.label}
          <span className="chip__x" aria-hidden>
            ×
          </span>
        </button>
      ))}
      <button type="button" className="link" onClick={() => onChange(patch({}, { sort: state.sort }))}>
        Clear all
      </button>
    </div>
  );
}

function Pill({ label, value, children }: { label: string; value?: string | number | false; children: ReactNode }) {
  return (
    <details className={`popover${value ? ' is-active' : ''}`}>
      <summary className="pill">{value ? `${label} · ${value}` : label}</summary>
      <div className="popover__panel">{children}</div>
    </details>
  );
}

function ApplyForm({ onApply, children }: { onApply: (f: FormData) => void; children: ReactNode }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onApply(new FormData(e.currentTarget));
    e.currentTarget.closest('details')!.open = false;
  }
  return (
    <form className="stack" onSubmit={submit}>
      {children}
      <button className="btn btn--primary btn--sm">Apply</button>
    </form>
  );
}

function CheckList(props: { options?: string[]; label?: (v: string) => string; selected?: string[]; onChange: (values: string[]) => void }) {
  const { options, label = (v) => v, selected = [], onChange } = props;
  if (!options) return <p className="muted small">Loading…</p>;
  return (
    <div className="stack">
      {options.map((o) => (
        <label key={o} className="check">
          <input type="checkbox" checked={selected.includes(o)} onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((v) => v !== o))} />
          {label(o)}
        </label>
      ))}
    </div>
  );
}

// <details> doesn't close on outside click by itself.
function useCloseOnOutsideClick() {
  useEffect(() => {
    const close = (e: PointerEvent) => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details.popover[open]')) if (!d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
}
