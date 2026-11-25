import { isBookable, PHYSICAL, type Reason, type SearchState, type Tour, type Trip } from '../../shared/types.ts';

// How well one trip satisfies the hard constraints of a search. Pure functions, no I/O.
// Each constraint yields a penalty ≥ 0 (0 = satisfied) that grows with distance (3 days late is better
// than 3 weeks), which is what makes "closest options" meaningful when nothing matches exactly.
// match = Π(1 - min(0.9, penalty)); the uncapped sum (`distance`) breaks ties between far-off options.

export { isBookable };

export interface Check {
  field: keyof SearchState; // the constraint the visitor set (departTo, returnBy, durationMax… — not a stand-in)
  penalty: number;
  reason: Reason;
  detail?: number; // magnitude for relaxation notes (days off, % over budget...)
  soft?: boolean; // preference: lowers ranking and confidence, but a trip can still be an exact match
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const euro = (n: number) => `€${n.toLocaleString('en-GB')}`;
const list = (xs: string[]) => xs.join(' / ');

export interface MatchContext {
  matchedMustHave: Set<number>; // indexes of state.mustHave found in the trip text (from ES named queries)
  continentOf: (destination: string) => string | undefined;
}

export function tripChecks(trip: Trip, s: SearchState, ctx: MatchContext): Check[] {
  const checks: Check[] = [];
  const add = (field: keyof SearchState, penalty: number, ok: string, ko: string, detail?: number) =>
    checks.push({ field, penalty, reason: { ok: penalty === 0, text: penalty === 0 ? ok : ko }, detail });

  if (s.destinations) {
    const sameContinent = s.destinations.some((d) => ctx.continentOf(d) === trip.continent);
    add('destinations', s.destinations.includes(trip.destination) ? 0 : sameContinent ? 0.5 : 0.8, `In ${trip.destination}`, `${trip.destination}, not ${list(s.destinations)}`);
  }
  if (s.continents) add('continents', s.continents.includes(trip.continent) ? 0 : 0.8, `In ${trip.continent}`, `In ${trip.continent}, not ${list(s.continents)}`);
  if (s.travelTypes) {
    const common = trip.travelTypes.filter((t) => s.travelTypes!.includes(t));
    add('travelTypes', common.length ? 0 : 0.4, `${list(common)} trip`, `Not a ${list(s.travelTypes)} trip`);
  }
  if (s.durationMin || s.durationMax) {
    const n = trip.numberOfDays;
    const short = Math.max(0, (s.durationMin ?? 0) - n);
    const off = Math.max(short, n - (s.durationMax ?? Infinity));
    const wanted = s.durationMin && s.durationMax ? `${s.durationMin}–${s.durationMax}` : s.durationMin ? `${s.durationMin}+` : `up to ${s.durationMax}`;
    const field = short > 0 || !s.durationMax ? 'durationMin' : 'durationMax';
    add(field, off * 0.08, `${n} days`, `${n} days (you asked ${wanted})`, off);
  }
  if (s.physical) {
    const level = PHYSICAL.indexOf(trip.physicalRating);
    const dist = Math.min(...s.physical.map((p) => Math.abs(PHYSICAL.indexOf(p) - level)));
    const label = { LOW: 'Easy', MEDIUM: 'Moderate', HIGH: 'Challenging' }[trip.physicalRating];
    add('physical', dist * 0.35, `${label} physical effort`, `${label} physical effort`);
  }
  s.mustHave?.forEach((term, i) => add('mustHave', ctx.matchedMustHave.has(i) ? 0 : 0.5, `Includes ${term}`, `No mention of ${term}`));
  return checks;
}

export function departureChecks(d: Tour, s: SearchState): Check[] {
  const checks: Check[] = [];
  const add = (field: keyof SearchState, penalty: number, ok: string, ko: string, detail?: number, soft = false) =>
    checks.push({ field, penalty, reason: { ok: penalty === 0, text: penalty === 0 ? ok : ko }, detail, soft });

  if (s.departFrom || s.departTo || s.returnBy) {
    const early = s.departFrom ? Math.max(0, daysBetween(d.startingDate, s.departFrom)) : 0;
    const late = s.departTo ? Math.max(0, daysBetween(s.departTo, d.startingDate)) : 0;
    const over = s.returnBy ? Math.max(0, daysBetween(s.returnBy, d.endingDate)) : 0;
    const off = early + late + over;
    const when = `${fmtDate(d.startingDate)} – ${fmtDate(d.endingDate)}`;
    const field = early ? 'departFrom' : late ? 'departTo' : over ? 'returnBy' : s.departFrom ? 'departFrom' : s.departTo ? 'departTo' : 'returnBy';
    add(field, off / 20, `${when}, fits your dates`, `${when}: ${days(off)} outside your dates`, off);
  }
  if (s.budgetMax) {
    const over = (d.priceEur - s.budgetMax) / s.budgetMax;
    add('budgetMax', Math.max(0, over * 1.5), `${euro(d.priceEur)}, within budget`, `${euro(d.priceEur)}: ${Math.round(over * 100)}% over your ${euro(s.budgetMax)} budget`, Math.round(over * 100));
  }
  // Age bands are indicative, not a rule (FAQ "How is a group made up on average?"), so a soft preference.
  if (s.ageBands) add('ageBands', s.ageBands.includes(d.ageBand) ? 0 : 0.1, `Age group ${d.ageBand}`, `Group usually aged ${d.ageBand} (a guide, not a rule)`, undefined, true);
  if (s.womenOnly) add('womenOnly', d.isWomenOnly ? 0 : 0.6, 'Women-only departure', 'Not a women-only departure');
  if (s.privateRoom) add('privateRoom', d.privateRoomBookable ? 0 : 0.3, 'Private room available', 'No private room option');
  if (s.confirmedOnly) add('confirmedOnly', d.isConfirmed ? 0 : 0.25, 'Confirmed departure', 'Not confirmed yet');
  if (s.minSeats) add('minSeats', d.seatsLeft >= s.minSeats ? 0 : 0.7, `${d.seatsLeft} seats left`, `Only ${d.seatsLeft} seat${d.seatsLeft > 1 ? 's' : ''} left for ${s.minSeats} of you`);
  return checks;
}

export const matchOf = (checks: Check[]) => checks.reduce((m, c) => m * (1 - Math.min(0.9, c.penalty)), 1);
/** Uncapped: tells "60% over budget" from "900% over" once both hit the 0.9 cap. */
export const distanceOf = (checks: Check[]) => checks.reduce((sum, c) => sum + c.penalty, 0);

export interface TripMatch {
  departures: Tour[]; // bookable, best first
  checks: Check[]; // trip checks + checks of the best departure
  match: number; // all checks, for ranking and confidence
  distance: number; // tie-breaker among equally capped matches
  meetsAll: boolean; // every hard constraint satisfied (soft preferences may still differ)
}

const DATE_FIELDS: (keyof SearchState)[] = ['departFrom', 'departTo', 'returnBy'];

/** Scores a trip against the constraints. Returns null when it has no bookable departure (never shown). */
export function matchTrip(trip: Trip, s: SearchState, ctx: MatchContext, today: string): TripMatch | null {
  const ranked = trip.tours
    .filter((d) => isBookable(d, today))
    .map((d) => ({ d, checks: departureChecks(d, s) }))
    .map((x) => ({ ...x, match: matchOf(x.checks), distance: distanceOf(x.checks) }))
    .sort(
      (a, b) =>
        b.match - a.match ||
        a.distance - b.distance ||
        (s.sort === 'price' ? a.d.priceEur - b.d.priceEur : a.d.startingDate.localeCompare(b.d.startingDate)),
    );
  if (!ranked.length) return null;
  const checks = [...tripChecks(trip, s, ctx), ...ranked[0].checks];
  // Each trip only lists its next 10 departures: a window after the last one means "not published yet", not "never".
  const lastStart = trip.tours.map((d) => d.startingDate).sort().at(-1)!;
  const dates = checks.find((c) => DATE_FIELDS.includes(c.field));
  if (dates && dates.penalty > 0 && s.departFrom && s.departFrom > lastStart)
    dates.reason = { ok: false, text: `Dates after ${fmtDate(lastStart)} not published yet` };
  // When some departures fit perfectly, don't pad the card with ones that don't.
  const shown = ranked[0].match === 1 ? ranked.filter((x) => x.match === 1) : ranked;
  return {
    departures: shown.slice(0, 3).map((x) => x.d),
    checks,
    match: matchOf(checks),
    distance: distanceOf(checks),
    meetsAll: checks.every((c) => c.soft || c.penalty === 0),
  };
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const range = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? days(xs[0]) : `${Math.min(...xs)}–${days(Math.max(...xs))}`);

// Related fields share one note: the visitor reads "dates", not departFrom/returnBy.
const GROUP: Partial<Record<keyof SearchState, keyof SearchState>> = { departTo: 'departFrom', returnBy: 'departFrom', durationMax: 'durationMin' };
const RELAX_NOTES: Partial<Record<keyof SearchState, (details: number[]) => string>> = {
  departFrom: (d) => `dates — the closest departures are ${range(d)} outside your window`,
  budgetMax: (d) => `budget — up to ${Math.max(...d)}% over`,
  durationMin: (d) => `duration — ${range(d)} longer or shorter`,
  destinations: () => 'destination — similar trips elsewhere',
  continents: () => 'region — trips on other continents',
  travelTypes: () => 'trip type',
  physical: () => 'physical effort',
  mustHave: () => "must-haves — these trips don't mention everything you asked for",
  ageBands: () => 'age group',
  womenOnly: () => 'women-only — no women-only departures are open right now',
  privateRoom: () => 'private room',
  confirmedOnly: () => 'confirmed departures — these are not confirmed yet',
  minSeats: () => 'group size — fewer seats left than you need',
};
/** Which constraints the shown non-exact results break, as human notes ("we loosened ..."). */
export function relaxationsOf(matches: TripMatch[]) {
  const groups = new Map<keyof SearchState, { field: keyof SearchState; details: number[] }>();
  for (const c of matches.flatMap((m) => m.checks).filter((c) => c.penalty > 0 && !c.soft)) {
    const key = GROUP[c.field] ?? c.field;
    const g = groups.get(key) ?? groups.set(key, { field: c.field, details: [] }).get(key)!;
    g.details.push(c.detail ?? 0);
  }
  return [...groups].map(([key, { field, details }]) => ({ field, note: RELAX_NOTES[key]?.(details) ?? String(field) }));
}
