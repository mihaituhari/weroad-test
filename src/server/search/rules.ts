import type { CatalogMeta, Mood, Physical, SearchState } from '../../shared/types.ts';

// Rule-based fallback when the LLM is unavailable (no key, timeout, error, daily budget). It only understands
// common patterns and removes filters only on explicit phrases ("start over", "any budget", "any dates"),
// so it is reported with lower understanding in confidence.ts. Unrecognised words go to `text`.

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASONS: Record<string, [number, number]> = { spring: [2, 4], summer: [5, 7], autumn: [8, 10], fall: [8, 10], winter: [11, 1] };
const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2 };
const MOOD_WORDS: Record<Mood, RegExp> = {
  party: /\b(party|parties|partying|nightlife|clubbing|drinks)\b/,
  relax: /\b(relax\w*|chill\w*|unwind|rest|slow pace|beaches?)\b/,
  nature: /\b(nature|wildlife|outdoors?|hiking|national parks?|landscapes?)\b/,
  culture: /\b(culture|cultural|art|museums?|local life|food)\b/,
  history: /\b(history|historic\w*|ancient|ruins|archaeolog\w*)\b/,
};
const STOPWORDS = new Set(
  `i im i'm me my we we're our us you a an the to in on at of for with and or but from by as into about around
   is are be was it its that this there here what where when which who how can could would should will do does
   want wanna like love looking look find show give need trip trips travel travelling traveling holiday vacation
   something somewhere some any only just please also really very more less than too much maybe actually instead
   go going visit see get have has time days day week weeks month euro euros eur max budget under up next between
   no not nothing hard easy people friends together old years year age aged trip's make stretch rather prefer change
   switch okay sure yes fine thanks thank cheaper longer shorter let's lets i'd would could them those these one ones
   else other another different kind sort type place places country countries abroad dates date price`.split(/\s+/),
);

// Everyday words one typo away from a destination: "hungry" is not Hungary.
const TYPO_COLLISIONS = new Set(['hungry', 'spin', 'pain', 'chin', 'chine', 'indie', 'italic', 'peri', 'perú']);

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase());
/** The next occurrence of a month (this year if not past, else next year). */
const yearOf = (month: number, today: string) => {
  const t = new Date(today);
  return month < t.getUTCMonth() ? t.getUTCFullYear() + 1 : t.getUTCFullYear();
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Edit distance ≤ 1 (one typo: "Japn", "Perú"→"peru" is handled by lowercasing). */
function oneTypo(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

export function parseRules(message: string, current: SearchState, meta: CatalogMeta, today: string): SearchState {
  let text = ` ${message.toLowerCase().replace(/[’]/g, "'")} `;
  if (/\b(start over|reset|clear (all|everything|filters))\b/.test(text)) return {};
  const s: SearchState = { ...current };
  const take = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.replace(m[0], ' ');
    return m;
  };

  // Dates: day range, month range, single month, season
  let m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:${MONTH}\\s*)?(?:-|–|to|until|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`));
  if (m) {
    const month = monthIndex(m[4]);
    const startMonth = m[2] ? monthIndex(m[2]) : month;
    // "19-24 November" on 25 November means next November, not a window in the past.
    let y = yearOf(startMonth, today);
    if (iso(y, startMonth, +m[1]) <= today) y++;
    Object.assign(s, { departFrom: iso(y, startMonth, +m[1]), returnBy: iso(month < startMonth ? y + 1 : y, month, +m[3]), departTo: undefined });
  } else if ((m = take(new RegExp(`\\b(?:between|from)\\s+${MONTH}\\s+(?:and|to|-|–|until)\\s+${MONTH}\\b`)))) {
    const [a, b] = [monthIndex(m[1]), monthIndex(m[2])];
    const y = yearOf(a, today);
    Object.assign(s, { departFrom: iso(y, a, 1), departTo: iso(b < a ? y + 1 : y, b + 1, 0), returnBy: undefined });
  } else if ((m = take(new RegExp(`\\b(?:in|during|around|for|early|mid|late|next)\\s+${MONTH}\\b`)))) {
    const a = monthIndex(m[1]);
    const y = yearOf(a, today);
    Object.assign(s, { departFrom: iso(y, a, 1), departTo: iso(y, a + 1, 0), returnBy: undefined });
  } else if ((m = take(/\b(?:this |next |in |during )?(spring|summer|autumn|fall|winter)\b/))) {
    const [a, b] = SEASONS[m[1]];
    const y = yearOf(a, today);
    Object.assign(s, { departFrom: iso(y, a, 1), departTo: iso(b < a ? y + 1 : y, b + 1, 0), returnBy: undefined });
  }

  // Budget, duration, group size, age
  if (take(/\b(any|no) (budget|price)\b|\b(budget|price) (doesn'?t|does not) matter\b/)) delete s.budgetMax;
  if (take(/\b(any|flexible) (dates?|time)\b|\bdates? (don'?t|do not|doesn'?t) matter\b/)) for (const k of ['departFrom', 'departTo', 'returnBy'] as const) delete s[k];
  if ((m = take(/\b(?:under|below|less than|max(?:imum)?|up to|no more than|stretch to|spend|afford|budget(?: of| is)?)\s*€?\s*(\d+(?:[.,]\d+)?)\s*(k)?\b(?:\s*(?:euros?|eur|€))?/))) {
    // "1,500" / "1.500" are thousands, "1.5k" is a decimal.
    const n = /^\d{1,3}[.,]\d{3}$/.test(m[1]) && !m[2] ? +m[1].replace(/[.,]/g, '') : parseFloat(m[1].replace(',', '.'));
    s.budgetMax = Math.round(n * (m[2] ? 1000 : 1));
  }
  if (take(/\b(cheap|cheapest|lowest price|affordable)\b/)) s.sort = 'price';
  if (take(/\b(as soon as possible|asap|soonest|earliest)\b/)) s.sort = 'date';
  if (take(/\bweekend\b/)) Object.assign(s, { durationMin: undefined, durationMax: 4 });
  else if ((m = take(/\b(at least |minimum |min )?(\d+|two|three)\s+weeks?\b/))) {
    const w = NUMBERS[m[2]] ?? +m[2];
    Object.assign(s, m[1] ? { durationMin: w * 7, durationMax: undefined } : { durationMin: w * 7 - 2, durationMax: w * 7 + 2 });
  } else if (take(/\b(a|one) week\b/)) Object.assign(s, { durationMin: 6, durationMax: 9 });
  else if ((m = take(/\b(\d+)\s*days?\b/))) Object.assign(s, { durationMin: Math.max(1, +m[1] - 1), durationMax: +m[1] + 1 });
  if ((m = take(/\b(?:we are|we're|group of|there are)\s+(\d+|two|three|four|five|six|seven|eight)\b|\b(\d+|two|three|four|five|six)\s+(?:of us|friends|people)\b/)))
    s.minSeats = NUMBERS[m[1] ?? m[2]] ?? +(m[1] ?? m[2]);
  else if (take(/\bwith my (partner|boyfriend|girlfriend|husband|wife|friend)\b/)) s.minSeats = 2;
  if ((m = take(/\b(?:i'?m|i am|aged?)\s+(\d{2})\b|\b(\d{2})\s+(?:years? old|yo)\b/))) {
    const age = +(m[1] ?? m[2]);
    const bands = meta.ageBands.filter((b) => {
      const [lo, hi] = b.split('-').map(Number);
      return age >= lo && age <= hi;
    });
    if (bands.length) s.ageBands = bands;
  }

  // Flags and effort
  if (take(/\b(women|female|girls?)[- ]only\b|\bonly (women|girls)\b/)) s.womenOnly = true;
  if (take(/\b(private|own|single) room\b/)) s.privateRoom = true;
  if (take(/\b(confirmed|guaranteed)( departures?)?\b/)) s.confirmedOnly = true;
  if (take(/\b(nothing too (hard|hard core|difficult|physical)|not too (hard|difficult|physical)|easy( going)?|low effort)\b/)) s.physical = ['LOW', 'MEDIUM'] as Physical[];
  else if (take(/\b(challenging|demanding|intense|tough|hard ?core|very active)\b/)) s.physical = ['HIGH'];

  // Must-haves: "only trips with a cooking class", "must include snorkeling"
  if ((m = take(/\b(?:only (?:trips |ones )?with|must (?:have|include)|that (?:has|have|includes?))\s+(?:an?\s+)?([a-z][a-z -]{2,30}?)(?=\s*(?:[,.!?]|$| and | under | in | for ))/)))
    s.mustHave = [...new Set([...(s.mustHave ?? []), m[1].trim()])];

  // Vocabulary: continents, destinations, trip types (a new mention replaces the previous choice)
  const found = (names: string[]) => names.filter((n) => new RegExp(`\\b${escape(n.toLowerCase())}\\b`).test(text));
  const continents = found(meta.continents);
  if (/\b(south|central|latin|north)? ?americas?\b/.test(text) && !continents.includes('America')) continents.push('America');
  const destinations = found(meta.destinations.map((d) => d.name));
  const words = text.split(/[^a-z]+/).filter((w) => w.length >= 4);
  for (const d of meta.destinations)
    if (!destinations.includes(d.name) && words.some((w) => !TYPO_COLLISIONS.has(w) && oneTypo(w, d.name.toLowerCase()))) destinations.push(d.name);
  if (/\b(usa|u\.s\.a?\.?|the us|new york)(?=\W|$)/.test(text)) destinations.push('United States'); // not bare "us": "there are 3 of us"
  if (/\bbali\b/.test(text)) destinations.push('Indonesia');
  const types = found(meta.travelTypes);
  for (const n of [...continents, ...destinations, ...types, 'americas', 'america', 'usa', 'bali']) text = text.replace(new RegExp(`\\b${escape(n.toLowerCase())}\\b`, 'g'), ' ');
  text = text.split(/\s+/).filter((w) => !destinations.some((d) => oneTypo(w, d.toLowerCase()))).join(' ');
  if (destinations.length) Object.assign(s, { destinations: [...new Set(destinations)], continents: undefined });
  else if (continents.length) Object.assign(s, { continents, destinations: undefined });
  if (types.length) s.travelTypes = types;

  const moods = Object.fromEntries(Object.entries(MOOD_WORDS).filter(([, re]) => re.test(text)).map(([k]) => [k, 1]));
  if (Object.keys(moods).length) s.moods = { ...s.moods, ...moods };

  // Whatever is left (minus stopwords) is the theme for semantic search.
  const rest = text.replace(/[^a-z' -]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (rest.length) s.text = rest.join(' ');
  return s;
}
