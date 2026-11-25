import type { ConfidenceLevel, Mood, Physical, SalesStatus, SearchResponse, SearchState } from '../../shared/types.ts';

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (n: number) => eur.format(n);
export const pct = (x: number) => `${Math.round(x * 100)}%`;

const thisYear = new Date().getFullYear();
/** "12 Dec", or "12 Dec 2027" outside the current year. Parsed as UTC so the day never shifts with the timezone. */
export function day(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  const year = d.getUTCFullYear() === thisYear ? undefined : 'numeric';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year, timeZone: 'UTC' });
}

export const levelOf = (score: number): ConfidenceLevel => (score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low');

export const PHYSICAL_LABEL: Record<Physical, string> = { LOW: 'Easy', MEDIUM: 'Moderate', HIGH: 'Challenging' };

export const STATUS_LABEL: Partial<Record<SalesStatus, string>> = {
  PLANNED: 'Open to book',
  ALMOST_CONFIRMED: 'Almost confirmed',
  CONFIRMED: 'Confirmed',
  ALMOST_FULL: 'Last spots',
};

export const INTERPRETER_LABEL: Record<SearchResponse['interpreter'], string> = {
  llm: 'Claude (AI)',
  rules: 'Rule-based fallback (AI unavailable)',
  none: 'Your filters only (no AI)',
};

// We have no photos: each continent gets its own gradient (see .tile--* in search.css).
const TILES = ['europe', 'asia', 'africa', 'america', 'oceania'];
export const tileClass = (continent: string) => `tile--${TILES.find((t) => continent.toLowerCase().includes(t)) ?? 'other'}`;

const isEmpty = (v: unknown) =>
  v === undefined || v === '' || v === false || Number.isNaN(v) || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);

/** Merges changes into the state and drops cleared fields: the API rejects nulls, and empty values only add noise to the log. */
export function patch(s: SearchState, changes: SearchState): SearchState {
  const next: Record<string, unknown> = { ...s, ...changes };
  for (const k of Object.keys(next)) if (isEmpty(next[k])) delete next[k];
  return next as SearchState;
}

export interface Chip {
  id: string;
  label: string;
  next: SearchState; // the state once this chip is removed
}

type ListKey = 'mustHave' | 'destinations' | 'continents' | 'travelTypes' | 'physical' | 'ageBands';

/** One removable chip per applied value, including fields only the assistant can set (mustHave, moods, returnBy). */
export function chips(s: SearchState): Chip[] {
  const out: Chip[] = [];
  const one = (key: keyof SearchState, label: string) => out.push({ id: key, label, next: patch(s, { [key]: undefined }) });
  const each = (key: ListKey, label: (v: string) => string) => {
    const values = (s[key] ?? []) as string[];
    for (const v of values) out.push({ id: `${key}:${v}`, label: label(v), next: patch(s, { [key]: values.filter((x) => x !== v) }) });
  };

  if (s.text) one('text', `“${s.text}”`);
  each('mustHave', (v) => `Must include: ${v}`);
  each('destinations', (v) => v);
  each('continents', (v) => v);
  each('travelTypes', (v) => v);
  if (s.departFrom) one('departFrom', `Departs from ${day(s.departFrom)}`);
  if (s.departTo) one('departTo', `Departs by ${day(s.departTo)}`);
  if (s.returnBy) one('returnBy', `Back by ${day(s.returnBy)}`);
  if (s.budgetMax) one('budgetMax', `Up to ${money(s.budgetMax)}`);
  if (s.durationMin) one('durationMin', `${s.durationMin}+ days`);
  if (s.durationMax) one('durationMax', `Max ${s.durationMax} days`);
  each('physical', (v) => `${PHYSICAL_LABEL[v as Physical]} effort`);
  each('ageBands', (v) => `Age ${v}`);
  if (s.womenOnly) one('womenOnly', 'Women only');
  if (s.privateRoom) one('privateRoom', 'Private room');
  if (s.confirmedOnly) one('confirmedOnly', 'Confirmed departures only');
  if (s.minSeats) one('minSeats', `${s.minSeats} travelling together`);
  for (const [mood, v] of Object.entries(s.moods ?? {})) {
    const { [mood as Mood]: _, ...rest } = s.moods!;
    if (v) out.push({ id: `moods:${mood}`, label: `Vibe: ${mood}`, next: patch(s, { moods: rest }) });
  }
  return out;
}
