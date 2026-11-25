import { es, INDEX } from '../es.ts';
import type { CatalogMeta, Faq } from '../../shared/types.ts';

// Lightweight RAG over the help centre: 50 short articles, so retrieval is one hybrid ES query
// and the "generation" is the same Claude call that interprets the message (no extra round trip).

export interface FaqHit {
  faq: Faq;
  lexical: number;
  semantic: number;
}

/**
 * Top FAQs for a visitor message. Destination articles are only eligible for the destinations being
 * discussed (current search + named in the message): "what plugs in Thailand?" must not be answered
 * with the near-identical Greece article.
 */
export async function searchFaqs(message: string, vector: number[], destinations: string[], size = 3): Promise<FaqHit[]> {
  const res = await es.search<Faq>({
    index: INDEX.faqs,
    size,
    include_named_queries_score: true,
    _source: { excludes: ['embedding'] },
    query: {
      bool: {
        filter: [{ bool: { should: [{ term: { scope: 'general' } }, { terms: { destination: destinations } }] } }],
        should: [
          { multi_match: { query: message, fields: ['title^2', 'body'], _name: 'lexical' } },
          { knn: { field: 'embedding', query_vector: vector, k: 10, num_candidates: 50, _name: 'semantic' } },
        ],
        minimum_should_match: 1,
      },
    },
  });
  return res.hits.hits.map((h) => {
    const named = (h.matched_queries ?? {}) as Record<string, number>;
    return { faq: h._source!, lexical: named.lexical ?? 0, semantic: named.semantic ?? 0 };
  });
}

/** Destinations named in a message ("plugs in Japan?"), so their FAQs become eligible. */
export const mentionedDestinations = (message: string, meta: CatalogMeta) =>
  meta.destinations.map((d) => d.name).filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(message));

/** One destination FAQ per destination, shown on result cards as "Good to know". */
export async function faqsByDestination(destinations: string[]): Promise<Map<string, Faq>> {
  if (!destinations.length) return new Map();
  const res = await es.search<Faq>({
    index: INDEX.faqs,
    size: 100,
    _source: { excludes: ['embedding'] },
    query: { terms: { destination: destinations } },
    sort: [{ id: 'asc' }],
  });
  const map = new Map<string, Faq>();
  for (const h of res.hits.hits) if (!map.has(h._source!.destination!)) map.set(h._source!.destination!, h._source!);
  return map;
}

/** Questions vs refinements, for the rule-based fallback (the LLM decides by itself). */
export const looksLikeQuestion = (message: string) =>
  /\?\s*$/.test(message) || /^(are|is|can|do|does|how|what|which|when|where|who|will|should)\b/i.test(message.trim());
