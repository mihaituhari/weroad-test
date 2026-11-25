import { MOODS, type SearchState, type Suggestion, type Tour, type Trip } from '../../shared/types.ts';

// For visitors who don't know what they want yet: when a search is broad, offer the facets that split
// the current results best ("Asia · 8", "January · 12", "Relax · 9"). Pure function over the result set.

const MIN_RESULTS = 7; // narrower searches don't need help
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export function suggestionsFor(pool: { trip: Trip; departures: Tour[] }[], s: SearchState): Suggestion[] {
  if (pool.length < MIN_RESULTS) return [];
  const out: Suggestion[] = [];
  const count = (pred: (x: (typeof pool)[number]) => boolean) => pool.filter(pred).length;
  const useful = (n: number) => n > 0 && n < pool.length; // a chip that keeps everything narrows nothing

  if (!s.continents && !s.destinations) {
    const byContinent = Map.groupBy(pool, (x) => x.trip.continent);
    for (const [continent, xs] of [...byContinent].sort((a, b) => b[1].length - a[1].length).slice(0, 4))
      if (useful(xs.length)) out.push({ facet: 'Region', label: continent, patch: { continents: [continent] }, count: xs.length });
  }
  if (!s.departFrom && !s.departTo && !s.returnBy) {
    const months = new Map<string, number>();
    for (const x of pool) for (const ym of new Set(x.departures.map((d) => d.startingDate.slice(0, 7)))) months.set(ym, (months.get(ym) ?? 0) + 1);
    for (const [ym, n] of [...months].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 4)) {
      const [y, m] = ym.split('-').map(Number);
      if (useful(n)) out.push({ facet: 'When', label: `${MONTHS[m - 1]} ${y}`, patch: { departFrom: iso(y, m - 1, 1), departTo: iso(y, m, 0) }, count: n });
    }
  }
  if (!s.moods) {
    for (const mood of MOODS) {
      const n = count((x) => x.trip.moods[mood] >= 60);
      if (useful(n)) out.push({ facet: 'Vibe', label: mood[0].toUpperCase() + mood.slice(1), patch: { moods: { [mood]: 1 } }, count: n });
    }
  }
  if (!s.durationMin && !s.durationMax) {
    const lengths: [string, SearchState][] = [
      ['Weekend', { durationMax: 4 }],
      ['About a week', { durationMin: 5, durationMax: 9 }],
      ['10+ days', { durationMin: 10 }],
    ];
    for (const [label, patch] of lengths) {
      const n = count((x) => x.trip.numberOfDays >= (patch.durationMin ?? 0) && x.trip.numberOfDays <= (patch.durationMax ?? Infinity));
      if (useful(n)) out.push({ facet: 'Length', label, patch, count: n });
    }
  }
  if (!s.budgetMax) {
    for (const max of [1000, 2000]) {
      const n = count((x) => x.departures.some((d) => d.priceEur <= max));
      if (useful(n)) out.push({ facet: 'Budget', label: `Under €${max.toLocaleString('en-GB')}`, patch: { budgetMax: max }, count: n });
    }
  }
  return out;
}
