import { randomUUID } from 'node:crypto';
import { es, INDEX } from '../es.ts';
import { getMeta } from '../catalog.ts';
import { embedOne } from '../embeddings.ts';
import { config, today } from '../config.ts';
import { normalizeState, redact } from './state.ts';
import { interpret, PROMPT_VERSION, type Interpretation } from './interpret.ts';
import { retrieve, type Candidate } from './retrieve.ts';
import { isBookable, matchTrip, relaxationsOf, type TripMatch } from './match.ts';
import { suggestionsFor } from './suggest.ts';
import { isExact, relevanceOf, resultConfidence, RELEVANT, searchConfidence, textDecides } from './confidence.ts';
import { faqsByDestination, mentionedDestinations, searchFaqs, type FaqHit } from './faq.ts';
import type { Reason, SearchLog, SearchRequest, SearchResponse, SearchState, TripResult } from '../../shared/types.ts';

// One search turn: interpret → retrieve (strict, then relaxed if needed) → match → confidence → log.

const MAX_EXACT = 12; // results when there are enough exact matches
const MIN_EXACT = 3; // below this we also show closest options...
const MAX_WITH_CLOSEST = 6; // ...up to this many results in total

export interface RunOptions {
  log?: boolean;
  forceRules?: boolean;
  model?: string;
}

interface Scored extends TripMatch {
  candidate: Candidate;
  relevance: number | null;
  confidence: number;
  exact: boolean;
  reasons: Reason[];
}

export async function runSearch(req: SearchRequest, opts: RunOptions = {}): Promise<{ response: SearchResponse; log: SearchLog }> {
  const started = performance.now();
  const now = today();
  const meta = await getMeta();
  const stateIn = normalizeState(req.state, meta).state;

  // Contact details never reach the LLM or the log.
  const message = req.message ? redact(req.message) : undefined;
  let interpretation: Interpretation | null = null;
  let faqHits: FaqHit[] = [];
  if (message) {
    const destinations = [...new Set([...(stateIn.destinations ?? []), ...mentionedDestinations(message, meta)])];
    faqHits = await searchFaqs(message, await embedOne(message), destinations);
    interpretation = await interpret({
      message,
      state: stateIn,
      history: req.history ?? [],
      faqHits,
      meta,
      today: now,
      forceRules: opts.forceRules,
      model: opts.model,
    });
  }
  const normalized = normalizeState(interpretation?.state ?? stateIn, meta);
  const state = normalized.state;
  const unmatched = [...new Set([...(interpretation?.unmatched ?? []), ...normalized.unmatched])];

  const searchStarted = performance.now();
  const vector = state.text ? await embedOne(state.text) : null;
  const continentOf = (d: string) => meta.destinations.find((x) => x.name === d)?.continent;
  const candidates = (await retrieve(state, vector, now)).map((c) => ({ c, ...relevanceOf(c.trip, state, c) }));
  const decisive = textDecides(state, candidates.map((x) => x.relevance));
  const scored: Scored[] = candidates.flatMap(({ c, relevance, reasons }) => {
    const m = matchTrip(c.trip, state, { matchedMustHave: c.matchedMustHave, continentOf }, now);
    if (!m) return [];
    return [
      {
        ...m,
        candidate: c,
        relevance,
        confidence: resultConfidence(m.match, relevance, decisive),
        exact: isExact(m.meetsAll, relevance, decisive),
        reasons: [...m.checks.map((x) => x.reason), ...reasons],
      },
    ];
  });
  const exact = scored.filter((s) => s.exact).sort(rank(state));
  const closest = scored.filter((s) => !s.exact).sort(rank(state));
  const shown = exact.length >= MIN_EXACT ? exact.slice(0, MAX_EXACT) : [...exact, ...closest].slice(0, Math.max(MAX_WITH_CLOSEST, exact.length));
  const searchMs = Math.round(performance.now() - searchStarted);

  const goodToKnow = await faqsByDestination([...new Set(shown.map((s) => s.candidate.trip.destination))]);
  const results: TripResult[] = shown.map((s) => toResult(s, goodToKnow));

  const relaxedShown = shown.filter((s) => !s.exact);
  const relaxed = relaxedShown.length ? relaxationsOf(relaxedShown) : [];
  if (state.text && decisive && !shown.some((s) => s.relevance !== null && s.relevance >= RELEVANT))
    relaxed.push({ field: 'text', note: `topic — nothing closely matches "${state.text}"` });

  const confidence = searchConfidence({
    interpreter: interpretation?.interpreter ?? 'none',
    llmCertainty: interpretation?.certainty,
    unmatched,
    top: results.map((r) => r.confidence),
    exactCount: exact.length,
  });

  if (!Object.keys(state).length)
    confidence.explanation = 'No criteria yet: these are all the trips with open departures. Tell the assistant what you like, or narrow it down below.';

  const reply = interpretation ? replyFor(interpretation, stateIn, state, exact.length) : null;
  const searchId = randomUUID();
  const response: SearchResponse = {
    searchId,
    state,
    reply,
    unmatched,
    relaxed,
    exactCount: exact.length,
    results,
    confidence,
    answer: interpretation?.answer ?? null,
    suggestions: exact.length >= MIN_EXACT ? suggestionsFor(exact.map((x) => ({ trip: x.candidate.trip, departures: x.candidate.trip.tours.filter((d) => isBookable(d, now)) })), state) : [],
    interpreter: interpretation?.interpreter ?? 'none',
  };

  const log: SearchLog = {
    id: searchId,
    at: new Date().toISOString(),
    sessionId: req.sessionId,
    mode: message ? 'assistant' : 'classic',
    message: message ?? null,
    stateIn,
    stateOut: state,
    interpreter: response.interpreter,
    model: interpretation?.model ?? null,
    reply,
    unmatched,
    relaxed: [...new Set(relaxed.map((r) => r.field))],
    zeroExact: exact.length === 0,
    exactCount: exact.length,
    resultCount: results.length,
    results: results.map((r) => ({ tripId: r.trip.id, title: r.trip.title, confidence: round(r.confidence), exact: r.exact })),
    confidence: round(confidence.score),
    confidenceLevel: confidence.level,
    faqIds: response.answer?.faqs.map((f) => f.id) ?? [],
    latencyMs: { total: Math.round(performance.now() - started), llm: interpretation?.llmMs ?? 0, search: searchMs },
    tokens: interpretation?.tokens ?? null,
    costUsd: interpretation?.costUsd ?? 0,
    error: interpretation?.error ?? null,
    version: `${config.version}/${PROMPT_VERSION}`,
    clicks: [],
    feedback: { vote: null, comment: null, results: [] },
  };
  if (opts.log !== false) es.index({ index: INDEX.searches, id: searchId, document: log }).catch((err) => console.error('[search log]', err.message));
  return { response, log };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

const rank = (s: SearchState) => (a: Scored, b: Scored) => {
  if (s.sort === 'price') return a.departures[0].priceEur - b.departures[0].priceEur;
  if (s.sort === 'date') return a.departures[0].startingDate.localeCompare(b.departures[0].startingDate);
  return b.confidence - a.confidence || (b.candidate.trip.rating?.value ?? 0) - (a.candidate.trip.rating?.value ?? 0);
};

function toResult(s: Scored, goodToKnow: Map<string, { id: number; title: string; url: string | null }>): TripResult {
  const { tours: _t, itinerary, description: _d, ...trip } = s.candidate.trip;
  const faq = goodToKnow.get(trip.destination);
  return {
    trip: { ...trip, highlights: itinerary.flatMap((d) => d.highlights).filter((h) => !/check-?(in|out)|goodbye/i.test(h)).slice(0, 6) },
    departures: s.departures,
    fromPrice: Math.min(...s.departures.map((d) => d.priceEur)),
    exact: s.exact,
    confidence: round(s.confidence),
    reasons: s.reasons,
    goodToKnow: faq ? { id: faq.id, title: faq.title, url: faq.url } : null,
  };
}

const FIELD_LABELS: Record<keyof SearchState, string> = {
  text: 'topic', mustHave: 'must-haves', destinations: 'destination', continents: 'region', travelTypes: 'trip type',
  departFrom: 'dates', departTo: 'dates', returnBy: 'dates', budgetMax: 'budget', durationMin: 'duration', durationMax: 'duration',
  physical: 'physical effort', ageBands: 'age group', womenOnly: 'women only', privateRoom: 'private room',
  confirmedOnly: 'confirmed departures', minSeats: 'group size', moods: 'vibe', sort: 'sorting',
};

/** The assistant's message: the LLM's own sentence, or a summary of what changed (rules), plus an honest note on results. */
function replyFor(i: Interpretation, before: SearchState, after: SearchState, exactCount: number) {
  const changed = (Object.keys({ ...before, ...after }) as (keyof SearchState)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const labels = [...new Set(changed.map((k) => FIELD_LABELS[k]))];
  const base = i.reply ?? (labels.length ? `Updated your search: ${labels.join(', ')}.` : i.answer ? 'Here is what our help centre says.' : "I couldn't find anything to change in your search.");
  const results = changed.length === 0 && i.answer ? '' : exactCount === 0 ? ' Nothing matches all of that right now, so I am showing the closest options.' : '';
  return base + results;
}
