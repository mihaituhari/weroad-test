import { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { config } from './config.ts';

export const es = new Client({ node: config.esUrl });

export const INDEX = { trips: 'trips', faqs: 'faqs', searches: 'searches', settings: 'settings' } as const;
export const EMBEDDING_DIMS = 384;

// Search-time synonyms: travel vocabulary users type vs words trip pages use.
// Zero-result queries in the search log are the place to find new ones.
const SYNONYMS = [
  'aurora, aurora borealis, northern lights',
  'hike, hiking, trek, trekking',
  'beach, seaside, sea, coast, island',
  'safari, wildlife, game drive, animals',
  'food, cuisine, culinary, gastronomy, foodie, street food',
  'cook, cooking, cookery',
  'nightlife, party, clubbing, bars, club',
  'christmas, xmas, christmas markets',
  'ruins, archaeological, archaeology, ancient',
  'snorkel, snorkeling, snorkelling',
  'scuba, scuba diving', // not bare "diving": trip texts say "dive into the old town"
  'temple, temples, pagoda, shrine',
  'volcano, volcanoes, volcanic',
  'spa, wellness, sauna, thermal baths, hot springs',
  'wine, vineyard, winery, tasting',
  'desert, dunes, sahara',
  'road trip, on the road, drive',
];

const textAnalysis: estypes.IndicesIndexSettings = {
  analysis: {
    filter: {
      travel_synonyms: { type: 'synonym_graph', synonyms: SYNONYMS },
      english_stemmer: { type: 'stemmer', language: 'english' },
      english_possessive: { type: 'stemmer', language: 'possessive_english' },
      english_stop: { type: 'stop', stopwords: '_english_' },
    },
    analyzer: {
      travel: { type: 'custom', tokenizer: 'standard', filter: ['english_possessive', 'lowercase', 'asciifolding', 'english_stop', 'english_stemmer'] },
      travel_search: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['english_possessive', 'lowercase', 'asciifolding', 'travel_synonyms', 'english_stop', 'english_stemmer'],
      },
    },
  },
};

const text = { type: 'text', analyzer: 'travel', search_analyzer: 'travel_search' } as const;
const textKeyword = { ...text, fields: { raw: { type: 'keyword' } } } as const;
const vector = { type: 'dense_vector', dims: EMBEDDING_DIMS, similarity: 'cosine', index: true } as const;

const tripsMapping: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'integer' },
    slug: { type: 'keyword' },
    url: { type: 'keyword', index: false },
    title: text,
    destination: textKeyword,
    continent: { type: 'keyword' },
    destinationLabel: text,
    numberOfDays: { type: 'integer' },
    startingPlace: text,
    endingPlace: text,
    arrivalAirport: { properties: { code: { type: 'keyword' }, city: { type: 'keyword' } } },
    travelStyle: { type: 'keyword' },
    travelTypes: textKeyword,
    moods: { properties: { party: { type: 'integer' }, relax: { type: 'integer' }, nature: { type: 'integer' }, culture: { type: 'integer' }, history: { type: 'integer' } } },
    physicalRating: { type: 'keyword' },
    shortDescription: text,
    description: text,
    rating: { properties: { value: { type: 'float' }, count: { type: 'integer' } } },
    itinerary: { properties: { day: { type: 'integer' }, title: text, nights: text, highlights: text } },
    tours: {
      type: 'nested',
      properties: {
        id: { type: 'keyword' },
        startingDate: { type: 'date' },
        endingDate: { type: 'date' },
        priceEur: { type: 'integer' },
        basePriceEur: { type: 'integer' },
        salesStatus: { type: 'keyword' },
        isConfirmed: { type: 'boolean' },
        maxPax: { type: 'integer' },
        seatsLeft: { type: 'integer' },
        paxBooked: { type: 'integer' },
        privateRoomBookable: { type: 'boolean' },
        isWomenOnly: { type: 'boolean' },
        ageBand: { type: 'keyword' },
      },
    },
    embedding: vector,
  },
};

const faqsMapping: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'integer' },
    scope: { type: 'keyword' },
    destination: { type: 'keyword' },
    title: text,
    body: text,
    url: { type: 'keyword', index: false },
    embedding: vector,
  },
};

// The search log is analytics data, written once per search and then updated with clicks and feedback.
// Built for Kibana: keywords + flattened states, with ignore_above so one oversized value can't reject a log.
const searchesMapping: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'keyword' },
    at: { type: 'date' },
    sessionId: { type: 'keyword' },
    mode: { type: 'keyword' },
    message: { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 512 } } },
    query: { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 512 } } },
    stateIn: { type: 'flattened', ignore_above: 512 },
    stateOut: { type: 'flattened', ignore_above: 512 },
    interpreter: { type: 'keyword' },
    model: { type: 'keyword' },
    reply: { type: 'text' },
    unmatched: { type: 'keyword', ignore_above: 256 },
    relaxed: { type: 'keyword' },
    zeroExact: { type: 'boolean' },
    exactCount: { type: 'integer' },
    resultCount: { type: 'integer' },
    results: {
      properties: { tripId: { type: 'integer' }, title: { type: 'keyword', fields: { text: { type: 'text' } } }, confidence: { type: 'float' }, exact: { type: 'boolean' } },
    },
    confidence: { type: 'float' },
    confidenceLevel: { type: 'keyword' },
    hasCriteria: { type: 'boolean' },
    faqIds: { type: 'integer' },
    latencyMs: { properties: { total: { type: 'integer' }, llm: { type: 'integer' }, search: { type: 'integer' } } },
    tokens: { properties: { input: { type: 'integer' }, output: { type: 'integer' }, cacheRead: { type: 'integer' } } },
    costUsd: { type: 'float' },
    error: { type: 'keyword', ignore_above: 512 },
    version: { type: 'keyword' },
    clicks: { properties: { tripId: { type: 'integer' }, position: { type: 'integer' }, exact: { type: 'boolean' }, at: { type: 'date' } } },
    feedback: {
      properties: {
        vote: { type: 'keyword' },
        comment: { type: 'text' },
        results: { properties: { tripId: { type: 'integer' }, vote: { type: 'keyword' } } },
      },
    },
  },
};

// One document (id "app"): runtime settings edited in /admin.
const settingsMapping: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: { llmModel: { type: 'keyword' }, dailyLlmBudgetUsd: { type: 'float' }, llmTimeoutMs: { type: 'integer' }, updatedAt: { type: 'date' } },
};

const DEFINITIONS = {
  [INDEX.trips]: { settings: textAnalysis, mappings: tripsMapping },
  [INDEX.faqs]: { settings: textAnalysis, mappings: faqsMapping },
  [INDEX.searches]: { mappings: searchesMapping },
  [INDEX.settings]: { mappings: settingsMapping },
};
// Only the catalog is rebuilt by a reset; the search log and settings are kept.
const REBUILDABLE: string[] = [INDEX.trips, INDEX.faqs];

/**
 * Creates missing indices and applies additive mapping changes to existing ones (new fields).
 * With `recreate`, drops and recreates the catalog indices (never the search log or settings).
 */
export async function ensureIndices({ recreate = false } = {}) {
  for (const [index, body] of Object.entries(DEFINITIONS)) {
    const exists = await es.indices.exists({ index });
    if (exists && recreate && REBUILDABLE.includes(index)) await es.indices.delete({ index });
    else if (exists) {
      await es.indices.putMapping({ index, ...body.mappings }).catch((err) => console.warn(`[es] ${index} mapping not updated: ${err.message}`));
      continue;
    }
    await es.indices.create({ index, ...body });
  }
}

/** Waits for Elasticsearch on boot (docker compose / Railway start order is not guaranteed). */
export async function waitForEs(attempts = 60) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (err) {
      console.log(`[boot] Elasticsearch at ${config.esUrl} not ready (attempt ${i}/${attempts}): ${(err as Error).message}`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
