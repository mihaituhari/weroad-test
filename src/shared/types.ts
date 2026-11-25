// Contract shared by the API (src/server) and the SPA (src/web). Keep it the single source of truth.

export const MOODS = ['party', 'relax', 'nature', 'culture', 'history'] as const;
export type Mood = (typeof MOODS)[number];
export const PHYSICAL = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Physical = (typeof PHYSICAL)[number];
export const SALES_STATUSES = ['PLANNED', 'ALMOST_CONFIRMED', 'CONFIRMED', 'ALMOST_FULL', 'WAITING_LIST', 'SOLD_OUT', 'NOT_AVAILABLE'] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];
/** Only these statuses can be booked. Everything else (sold out, waiting list, closed) is never shown. */
export const BOOKABLE_STATUSES: SalesStatus[] = ['PLANNED', 'ALMOST_CONFIRMED', 'CONFIRMED', 'ALMOST_FULL'];

// ---------- Catalog ----------

export interface Tour {
  id: string;
  startingDate: string; // YYYY-MM-DD
  endingDate: string;
  priceEur: number;
  basePriceEur: number | null; // pre-discount price when discounted
  salesStatus: SalesStatus;
  isConfirmed: boolean;
  maxPax: number;
  seatsLeft: number;
  paxBooked: number;
  privateRoomBookable: boolean;
  isWomenOnly: boolean;
  ageBand: string; // "18-25" | "25-35" | "25-49"
}

export interface ItineraryDay {
  day: number;
  title: string;
  nights: string | null;
  highlights: string[];
}

export interface Trip {
  id: number;
  slug: string;
  url: string;
  title: string;
  destination: string; // country
  continent: string;
  destinationLabel: string;
  numberOfDays: number;
  startingPlace: string;
  endingPlace: string;
  arrivalAirport?: { code: string; city: string } | null;
  travelStyle: string;
  travelTypes: string[];
  moods: Record<Mood, number>; // 0-100
  physicalRating: Physical;
  shortDescription: string | null;
  description: string;
  rating: { value: number; count: number } | null;
  itinerary: ItineraryDay[];
  tours: Tour[];
}

export interface Faq {
  id: number;
  scope: 'general' | 'destination';
  destination: string | null; // links a FAQ to trips with the same destination
  title: string;
  body: string;
  url: string | null;
}

/** Vocabulary the UI and the LLM can use, derived from the catalog at runtime. */
export interface CatalogMeta {
  destinations: { name: string; continent: string }[];
  continents: string[];
  travelTypes: string[];
  ageBands: string[];
  priceRange: [number, number];
  durationRange: [number, number];
  dateRange: [string, string]; // first/last bookable departure
  kibanaUrl: string | null;
}

// ---------- Search ----------

/**
 * The search the user is looking at. The classic search bar edits it directly;
 * the assistant edits it from natural language. Every field is optional.
 */
export interface SearchState {
  text?: string; // free text / theme, ranked lexically + semantically (soft)
  mustHave?: string[]; // features the trip must mention, e.g. "cooking class" (hard, relaxable)
  destinations?: string[]; // countries
  continents?: string[];
  travelTypes?: string[]; // any-of
  departFrom?: string; // YYYY-MM-DD, departure on/after
  departTo?: string; // departure on/before
  returnBy?: string; // trip must end on/before ("I only have 19-24 Oct")
  budgetMax?: number; // EUR per person
  durationMin?: number; // days
  durationMax?: number;
  physical?: Physical[];
  ageBands?: string[];
  womenOnly?: boolean;
  privateRoom?: boolean;
  confirmedOnly?: boolean; // guaranteed departures only
  minSeats?: number; // group size travelling together
  moods?: Partial<Record<Mood, number>>; // desired intensity 0..1 (soft)
  sort?: 'relevance' | 'price' | 'date';
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SearchRequest {
  sessionId: string;
  state: SearchState;
  message?: string; // natural-language refinement; absent = classic search, no LLM call
  history?: ChatTurn[]; // previous turns, most recent last (server keeps the last few)
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Reason {
  ok: boolean;
  text: string; // "In Asia", "Departs 26 Oct: 2 days after your window"
}

export interface TripResult {
  trip: Omit<Trip, 'tours' | 'itinerary' | 'description'> & { highlights: string[] };
  departures: Tour[]; // bookable departures, best match first (max 3)
  fromPrice: number;
  exact: boolean; // satisfies every hard constraint
  confidence: number; // 0..1, how well this trip matches the request
  reasons: Reason[];
  goodToKnow: Pick<Faq, 'id' | 'title' | 'url'> | null; // destination FAQ
}

export interface Relaxation {
  field: keyof SearchState;
  note: string; // human explanation of what we loosened
}

export interface Confidence {
  score: number; // 0..1
  level: ConfidenceLevel;
  explanation: string;
  understanding: number; // how sure we are we parsed the request (1 for classic search)
  matchQuality: number; // mean confidence of the top results
}

export interface FaqAnswer {
  text: string; // grounded answer, only from FAQ content
  faqs: Pick<Faq, 'id' | 'title' | 'url'>[];
}

/** One-click refinements for broad searches ("Not sure? Narrow it down"). Applying = merge `patch` into the state. */
export interface Suggestion {
  facet: 'Region' | 'When' | 'Vibe' | 'Length' | 'Budget';
  label: string;
  patch: SearchState;
  count: number; // trips in the current results that match
}

export interface SearchResponse {
  searchId: string;
  state: SearchState; // the state that was actually searched
  reply: string | null; // assistant message for this turn
  unmatched: string[]; // parts of the request we could not map to trip data
  relaxed: Relaxation[]; // non-empty when we had to show closest options
  exactCount: number;
  results: TripResult[];
  confidence: Confidence;
  answer: FaqAnswer | null;
  suggestions: Suggestion[];
  interpreter: 'llm' | 'rules' | 'none';
}

/** A visitor opened a trip from the results: the implicit signal we measure impact with. */
export interface ClickRequest {
  tripId: number;
  position: number; // 1-based rank in the results
}

export interface FeedbackRequest {
  vote: 'up' | 'down';
  tripId?: number; // omitted = feedback on the whole result list
  comment?: string;
}

// ---------- Search log (admin) ----------

export interface SearchLog {
  id: string;
  at: string; // ISO timestamp
  sessionId: string;
  mode: 'classic' | 'assistant';
  message: string | null;
  stateIn: SearchState;
  stateOut: SearchState;
  interpreter: 'llm' | 'rules' | 'none';
  model: string | null;
  reply: string | null;
  unmatched: string[];
  relaxed: string[]; // relaxed field names
  zeroExact: boolean;
  exactCount: number;
  resultCount: number;
  results: { tripId: number; title: string; confidence: number; exact: boolean }[];
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  faqIds: number[];
  latencyMs: { total: number; llm: number; search: number };
  tokens: { input: number; output: number; cacheRead: number } | null;
  costUsd: number;
  error: string | null;
  version: string; // app commit + prompt version, to compare algorithm versions
  clicks: { tripId: number; position: number; exact: boolean; at: string }[];
  feedback: {
    vote: 'up' | 'down' | null;
    comment: string | null;
    results: { tripId: number; vote: 'up' | 'down' }[];
  };
}

export interface SearchLogQuery {
  q?: string;
  mode?: 'classic' | 'assistant';
  level?: ConfidenceLevel;
  zeroExact?: boolean;
  feedback?: 'up' | 'down' | 'none';
  interpreter?: 'llm' | 'rules' | 'none';
  from?: string;
  to?: string;
  page?: number; // 1-based, 25 per page
}

export interface SearchStats {
  total: number;
  assistantShare: number;
  zeroExactRate: number;
  avgConfidence: number;
  feedbackUp: number;
  feedbackDown: number;
  ctr: number; // searches with at least one trip opened
  rescueRate: number; // zero-exact searches where the visitor still opened a closest option
  byLevel: { level: ConfidenceLevel; searches: number; ctr: number; upRate: number | null }[]; // is confidence honest?
  latencyP50: number;
  latencyP95: number;
  totalCostUsd: number;
  topUnmatched: { term: string; count: number }[];
  topZeroQueries: { message: string; count: number }[];
}

export interface Page<T> {
  items: T[];
  total: number;
}
