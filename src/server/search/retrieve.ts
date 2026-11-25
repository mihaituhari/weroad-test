import type { estypes } from '@elastic/elasticsearch';
import { es, INDEX } from '../es.ts';
import { BOOKABLE_STATUSES, type SearchState, type Trip } from '../../shared/types.ts';

// Elasticsearch retrieval. Hard constraints become filters; free text is scored twice in the same
// query: BM25 (`lexical`, with synonyms + fuzziness for typos) and kNN on the trip embedding
// (`semantic`). `include_named_queries_score` returns both scores per hit, so ranking and
// confidence can use them separately.

export const TEXT_FIELDS = ['title^3', 'destination^4', 'destinationLabel^3', 'travelTypes^2', 'itinerary.highlights^2', 'itinerary.title^1.5', 'shortDescription', 'description'];

export interface Candidate {
  trip: Trip;
  lexical: number;
  semantic: number;
  matchedTerms: string[]; // which words of the free text the trip mentions (for honest "mentions ..." reasons)
  coverage: number; // matchedTerms / all terms, 0 when there is no free text
  matchedMustHave: Set<number>;
}

const STOP = new Set(['and', 'the', 'with', 'for', 'trip', 'trips', 'tour', 'some', 'that', 'want', 'like', 'good', 'nice', 'great', 'best']);
export const termsOf = (text: string) =>
  [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);

type Query = estypes.QueryDslQueryContainer;

const bookable = (today: string): Query[] => [
  { terms: { 'tours.salesStatus': BOOKABLE_STATUSES } },
  { range: { 'tours.seatsLeft': { gt: 0 } } },
  { range: { 'tours.startingDate': { gt: today } } },
];

function departureFilters(s: SearchState): Query[] {
  const f: Query[] = [];
  if (s.departFrom || s.departTo) f.push({ range: { 'tours.startingDate': { gte: s.departFrom, lte: s.departTo } } });
  if (s.returnBy) f.push({ range: { 'tours.endingDate': { lte: s.returnBy } } });
  if (s.budgetMax) f.push({ range: { 'tours.priceEur': { lte: s.budgetMax } } });
  if (s.womenOnly) f.push({ term: { 'tours.isWomenOnly': true } });
  if (s.privateRoom) f.push({ term: { 'tours.privateRoomBookable': true } });
  if (s.confirmedOnly) f.push({ term: { 'tours.isConfirmed': true } });
  if (s.minSeats) f.push({ range: { 'tours.seatsLeft': { gte: s.minSeats } } });
  return f;
}

function tripFilters(s: SearchState): Query[] {
  const f: Query[] = [];
  if (s.destinations) f.push({ terms: { 'destination.raw': s.destinations } });
  if (s.continents) f.push({ terms: { continent: s.continents } });
  if (s.travelTypes) f.push({ terms: { 'travelTypes.raw': s.travelTypes } });
  if (s.durationMin || s.durationMax) f.push({ range: { numberOfDays: { gte: s.durationMin, lte: s.durationMax } } });
  if (s.physical) f.push({ terms: { physicalRating: s.physical } });
  return f;
}

const mustHaveQuery = (term: string, i: number): Query => ({ multi_match: { query: term, fields: TEXT_FIELDS, operator: 'and', _name: `must:${i}` } });

/**
 * Two queries in parallel, merged by trip:
 *  - strict: every hard constraint is a filter, so exact matches are never missed on a large catalog;
 *  - relaxed: only "has a bookable departure" is a filter, ranked by text: the pool for closest options.
 * match.ts then re-checks every constraint on every candidate, so both sets are scored the same way.
 */
export async function retrieve(s: SearchState, vector: number[] | null, today: string): Promise<Candidate[]> {
  const terms = s.text ? termsOf(s.text) : [];
  const must = (s.mustHave ?? []).map(mustHaveQuery);
  const should: Query[] = [];
  if (s.text) should.push({ multi_match: { query: s.text, fields: TEXT_FIELDS, fuzziness: 'AUTO', prefix_length: 1, _name: 'lexical' } });
  terms.forEach((t, i) => should.push({ multi_match: { query: t, fields: TEXT_FIELDS, fuzziness: 'AUTO', prefix_length: 1, boost: 0, _name: `term:${i}` } }));
  if (vector) should.push({ knn: { field: 'embedding', query_vector: vector, k: 100, num_candidates: 200, _name: 'semantic' } });
  const departures = (filters: Query[]): Query => ({ nested: { path: 'tours', query: { bool: { filter: [...bookable(today), ...filters] } } } });

  const queries: Query[] = [
    { bool: { filter: [...tripFilters(s), departures(departureFilters(s))], must, should } },
    { bool: { filter: [departures([])], should: [...should, ...must] } },
  ];
  const responses = await Promise.all(
    queries.map((query) => es.search<Trip>({ index: INDEX.trips, size: 100, include_named_queries_score: true, _source: { excludes: ['embedding'] }, query })),
  );

  const byId = new Map<number, Candidate>();
  for (const h of responses.flatMap((r) => r.hits.hits)) {
    if (byId.has(h._source!.id)) continue;
    const named = (h.matched_queries ?? {}) as Record<string, number>;
    const matchedTerms = terms.filter((_, i) => `term:${i}` in named);
    byId.set(h._source!.id, {
      trip: h._source!,
      lexical: named.lexical ?? 0,
      semantic: named.semantic ?? 0,
      matchedTerms,
      coverage: terms.length ? matchedTerms.length / terms.length : 0,
      matchedMustHave: new Set(Object.keys(named).filter((k) => k.startsWith('must:')).map((k) => Number(k.slice(5)))),
    });
  }
  return [...byId.values()];
}
