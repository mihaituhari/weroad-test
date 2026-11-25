import { today } from '../src/server/config.ts';
import type { SearchState } from '../src/shared/types.ts';

/**
 * What the final turn must satisfy. Every field is scored as a separate check.
 * `state` semantics: arrays = each expected item is a case-insensitive substring of some actual item,
 * numbers = within ±10%, strings/dates = case-insensitive substring (a full date is exact, "YYYY-MM" = any day
 * of that month), booleans = exact, moods = expected keys present with value >= 0.5.
 */
export interface Expect {
  state?: Partial<SearchState>;
  topAnyOf?: number[]; // at least one of these trip ids in the top 3
  noneOf?: number[]; // none of these trip ids anywhere in the results
  minExact?: number;
  zeroExact?: boolean; // exactCount must be 0 and results non-empty (closest options, no dead end)
  maxConfidence?: number; // honesty: we must not sound sure
  minConfidence?: number;
  answerFaqAnyOf?: number[]; // response.answer.faqs must cite one of these
  unmatched?: boolean; // response.unmatched must be non-empty
}

/** `start` runs first as a classic search (no message), then each turn is sent like the UI does. */
export interface EvalCase {
  id: string;
  tags: string[];
  start?: SearchState;
  turns: string[];
  expect: Expect;
}

// Departure dates are shifted at seed time, so date cases assert the parsed state, never trip ids.
const now = today();
const pad = (n: number) => String(n).padStart(2, '0');
const year = Number(now.slice(0, 4));
/** Next YYYY-MM-DD after today for a month/day: what a visitor means by "19 October". */
const nextDay = (m: number, d: number) => `${`${year}-${pad(m)}-${pad(d)}` > now ? year : year + 1}-${pad(m)}-${pad(d)}`;
/** YYYY-MM of the next such month, current month included: what "in March" means. */
const nextMonth = (m: number) => `${pad(m) >= now.slice(5, 7) ? year : year + 1}-${pad(m)}`;

const ASIA = [2, 4, 7, 8, 15, 16, 19, 28, 29, 40, 43, 45];
const EUROPE_WEEKENDS = [5, 12, 21, 27, 30, 31, 36, 46, 48, 49];

export const CASES: EvalCase[] = [
  // Destinations and continents
  { id: 'dest-japan', tags: ['destination'], turns: ['I want to go to Japan'], expect: { state: { destinations: ['Japan'] }, topAnyOf: [2], minExact: 1, minConfidence: 0.6 } },
  { id: 'typo-japn', tags: ['destination', 'typo'], turns: ['a trip to Japn'], expect: { state: { destinations: ['Japan'] }, topAnyOf: [2] } },
  { id: 'africa-backfilled-cheap', tags: ['continent', 'budget', 'data-fix'], turns: ['cheap trips in Africa under 1000 euros'], expect: { state: { continents: ['Africa'], budgetMax: 1000 }, topAnyOf: [3, 47], minExact: 1 } },
  { id: 'europe-backfilled-aurora', tags: ['continent', 'data-fix', 'synonym'], turns: ['northern lights somewhere in Europe'], expect: { state: { continents: ['Europe'] }, topAnyOf: [9, 11] } },

  // Keywords, synonyms, semantic
  { id: 'synonym-aurora', tags: ['synonym'], turns: ['where can I see the aurora borealis?'], expect: { topAnyOf: [9, 11, 41] } },
  { id: 'semantic-sushi', tags: ['semantic', 'classic'], start: { text: 'sushi and temples' }, turns: [], expect: { topAnyOf: [2] } },
  { id: 'must-cooking-class', tags: ['must-have'], turns: ['only trips with a cooking class'], expect: { state: { mustHave: ['cook'] }, topAnyOf: [13, 15, 19, 24, 40], minExact: 1 } },
  { id: 'christmas-markets', tags: ['keyword'], turns: ['Christmas markets'], expect: { topAnyOf: [14, 42] } },
  { id: 'type-safari', tags: ['travel-type', 'continent'], turns: ['I want to go on a safari in Africa'], expect: { state: { continents: ['Africa'] }, topAnyOf: [26, 44], minExact: 1 } },

  // Budget and duration
  { id: 'budget-asia', tags: ['budget', 'continent'], turns: ['Asia under 1500 euros'], expect: { state: { continents: ['Asia'], budgetMax: 1500 }, topAnyOf: [8, 15, 40, 43, 45], noneOf: [2, 4, 28], minExact: 3 } },
  { id: 'budget-impossible', tags: ['budget', 'honesty'], turns: ['a trip under 100 euros'], expect: { state: { budgetMax: 100 }, zeroExact: true, maxConfidence: 0.5 } },
  { id: 'duration-weekend', tags: ['duration', 'continent'], turns: ['a weekend city break in Europe'], expect: { state: { continents: ['Europe'] }, topAnyOf: EUROPE_WEEKENDS, minExact: 3 } },
  { id: 'duration-two-weeks', tags: ['duration'], turns: ['a trip of at least two weeks'], expect: { state: { durationMin: 14 }, minExact: 1 } },

  // Dates
  { id: 'dates-window', tags: ['dates'], start: { text: 'weekend city break' }, turns: ['I only have 19-24 October'], expect: { state: { departFrom: nextDay(10, 19), returnBy: nextDay(10, 24) } } },
  { id: 'dates-month', tags: ['dates', 'destination'], turns: ['Japan in March'], expect: { state: { destinations: ['Japan'], departFrom: nextMonth(3), departTo: nextMonth(3) }, topAnyOf: [2] } },
  { id: 'dates-season', tags: ['dates', 'continent'], turns: ['somewhere in Europe next summer'], expect: { state: { continents: ['Europe'], departFrom: nextMonth(6), departTo: nextMonth(8) } } },

  // Vibes, people, effort, departure filters
  { id: 'mood-party-age', tags: ['mood', 'age'], turns: ['I want to party and chill on beaches, I am 23'], expect: { state: { moods: { party: 1 }, ageBands: ['18-25'] } } },
  { id: 'mood-relax', tags: ['mood'], turns: ['somewhere quiet to relax and recharge'], expect: { state: { moods: { relax: 1 } } } },
  { id: 'physical-high', tags: ['physical'], turns: ['a tough trek, I am very fit and want a real challenge'], expect: { state: { physical: ['HIGH'] }, topAnyOf: [20, 23, 32, 34] } },
  { id: 'group-of-4', tags: ['group', 'destination'], turns: ['we are 4 friends going to Morocco'], expect: { state: { destinations: ['Morocco'], minSeats: 4 }, topAnyOf: [3] } },
  { id: 'confirmed-private-room', tags: ['filters', 'destination'], turns: ['Egypt, only guaranteed departures, and I want a private room'], expect: { state: { destinations: ['Egypt'], confirmedOnly: true, privateRoom: true }, topAnyOf: [6], minExact: 1 } },

  // Honesty: impossible or unknown requests
  { id: 'women-only', tags: ['honesty', 'filters'], turns: ['women only trip in Europe'], expect: { state: { womenOnly: true, continents: ['Europe'] }, zeroExact: true, maxConfidence: 0.6 } },
  { id: 'unknown-antarctica', tags: ['honesty', 'unknown'], turns: ['Antarctica to see penguins'], expect: { unmatched: true, maxConfidence: 0.5, topAnyOf: [23, 26] } },
  { id: 'unmatched-dog', tags: ['honesty', 'unknown'], turns: ['a dog-friendly trip to Spain, I am bringing my dog'], expect: { state: { destinations: ['Spain'] }, unmatched: true } },
  { id: 'aurora-under-1000', tags: ['honesty', 'budget'], start: { text: 'northern lights' }, turns: ['my budget is 1000 euros max'], expect: { state: { budgetMax: 1000 }, zeroExact: true, topAnyOf: [9, 11, 41] } },

  // FAQ (RAG)
  { id: 'faq-flights', tags: ['faq'], start: { destinations: ['Japan'] }, turns: ['are flights included?'], expect: { state: { destinations: ['Japan'] }, answerFaqAnyOf: [1] } },
  { id: 'faq-currency-peru', tags: ['faq'], turns: ['which currency do they use in Peru?'], expect: { answerFaqAnyOf: [48] } },
  { id: 'faq-search-and-question', tags: ['faq', 'destination'], turns: ['Iceland in winter, what is the weather like there?'], expect: { state: { destinations: ['Iceland'] }, answerFaqAnyOf: [34], topAnyOf: [9] } },

  // Multi-turn: later turns narrow, change or loosen earlier ones
  { id: 'multi-faq-there', tags: ['multi-turn', 'faq'], start: { text: 'temples' }, turns: ['Japan please', 'what plugs do they use there?'], expect: { state: { destinations: ['Japan'] }, answerFaqAnyOf: [39], topAnyOf: [2] } },
  { id: 'multi-change-continent', tags: ['multi-turn', 'continent'], turns: ['something in Asia', 'actually, make it Europe instead'], expect: { state: { continents: ['Europe'] }, noneOf: ASIA, minExact: 3 } },
  {
    id: 'multi-asia-winter-cooking',
    tags: ['multi-turn', 'dates', 'must-have', 'budget'],
    start: { continents: ['Asia'] },
    turns: ['something warm between December and February', 'only trips with a cooking class', 'max 1800 euros'],
    expect: { state: { continents: ['Asia'], mustHave: ['cook'], budgetMax: 1800, departFrom: nextMonth(12), departTo: nextMonth(2) }, topAnyOf: [15, 19, 40] },
  },
  { id: 'multi-easy-hike-friends', tags: ['multi-turn', 'physical', 'group', 'filters'], start: { text: 'hiking' }, turns: ['nothing too hard, we are 3 friends', 'only confirmed departures please'], expect: { state: { physical: ['LOW'], minSeats: 3, confirmedOnly: true } } },
  // Regressions found by the review (docs/ai-workflow/review.workflow.js)
  { id: 'sort-keeps-closest', tags: ['honesty', 'review'], start: { destinations: ['Japan'], budgetMax: 2000, sort: 'price' }, turns: [], expect: { zeroExact: true, topAnyOf: [2, 15, 8, 16, 19, 7], maxConfidence: 0.7 } },
  { id: 'must-snorkel-europe', tags: ['honesty', 'must-have', 'review'], start: { mustHave: ['snorkeling'], continents: ['Europe'] }, turns: [], expect: { zeroExact: true, maxConfidence: 0.7 } },
  { id: 'all-unmatched-classic', tags: ['honesty', 'review'], start: { destinations: ['Antarctica'] }, turns: [], expect: { unmatched: true, maxConfidence: 0.3 } },
  { id: 'multi-loosen-budget', tags: ['multi-turn', 'budget'], start: { destinations: ['Iceland'], budgetMax: 1000 }, turns: ['ok, I can stretch to 2000'], expect: { state: { destinations: ['Iceland'], budgetMax: 2000 }, topAnyOf: [9], minExact: 1 } },
];
