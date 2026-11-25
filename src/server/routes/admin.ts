import { Hono } from 'hono';
import { z } from 'zod';
import type { estypes } from '@elastic/elasticsearch';
import { es, INDEX } from '../es.ts';
import { deleteFaq, deleteTrip, getTrip, listFaqs, listTrips, nextId, rawDoc, saveFaq, saveTrip } from '../catalog.ts';
import { seed } from '../seed.ts';
import { config } from '../config.ts';
import { defaults, getSettings, saveSettings } from '../settings.ts';
import { spentToday } from '../search/interpret.ts';
import type { ConfidenceLevel, Page, SearchLog, SearchStats, SettingsView } from '../../shared/types.ts';

// Backoffice API. No auth: demo only (see docs/DECISIONS.md).

const PAGE_SIZE = 25;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LogQuerySchema = z.object({
  q: z.string().max(200).optional(),
  mode: z.enum(['classic', 'assistant']).optional(),
  level: z.enum(['high', 'medium', 'low']).optional(),
  zeroExact: z.enum(['true', 'false']).optional(),
  feedback: z.enum(['up', 'down', 'none']).optional(),
  interpreter: z.enum(['llm', 'rules', 'none']).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  page: z.coerce.number().int().min(1).max(10_000 / PAGE_SIZE).default(1), // ES max_result_window
});
type LogQuery = z.infer<typeof LogQuerySchema>;

// Feedback is a vote on the whole list or on single trips ("Good suggestion?"): both count.
const voted = (vote: 'up' | 'down'): estypes.QueryDslQueryContainer => ({
  bool: { should: [{ term: { 'feedback.vote': vote } }, { term: { 'feedback.results.vote': vote } }], minimum_should_match: 1 },
});
const anyVote: estypes.QueryDslQueryContainer = {
  bool: { should: [{ exists: { field: 'feedback.vote' } }, { exists: { field: 'feedback.results.vote' } }], minimum_should_match: 1 },
};
const id = (raw: string) => Number(raw);

export const adminRoutes = new Hono()
  // ---------- Trips ----------
  .get('/trips', async (c) => c.json(await listTrips(c.req.query('q') || undefined)))
  .get('/trips/:id', async (c) => {
    const trip = await getTrip(id(c.req.param('id')));
    if (!trip) return c.json({ error: 'trip not found' }, 404);
    return c.json({ ...trip, faqs: await listFaqs(trip.destination) });
  })
  .get('/trips/:id/raw', async (c) => {
    const doc = await rawDoc(INDEX.trips, id(c.req.param('id')));
    return doc ? c.json(doc) : c.json({ error: 'trip not found' }, 404);
  })
  .post('/trips', async (c) => c.json(await saveTrip({ ...(await c.req.json()), id: await nextId(INDEX.trips) }), 201))
  .put('/trips/:id', async (c) => c.json(await saveTrip({ ...(await c.req.json()), id: id(c.req.param('id')) })))
  .delete('/trips/:id', async (c) => (await deleteTrip(id(c.req.param('id'))), c.json({ ok: true })))

  // ---------- FAQs ----------
  .get('/faqs', async (c) => c.json(await listFaqs(c.req.query('destination') || undefined)))
  .get('/faqs/:id/raw', async (c) => {
    const doc = await rawDoc(INDEX.faqs, id(c.req.param('id')));
    return doc ? c.json(doc) : c.json({ error: 'FAQ not found' }, 404);
  })
  .post('/faqs', async (c) => c.json(await saveFaq({ ...(await c.req.json()), id: await nextId(INDEX.faqs) }), 201))
  .put('/faqs/:id', async (c) => c.json(await saveFaq({ ...(await c.req.json()), id: id(c.req.param('id')) })))
  .delete('/faqs/:id', async (c) => (await deleteFaq(id(c.req.param('id'))), c.json({ ok: true })))

  // ---------- Search log ----------
  .get('/searches/stats', async (c) => c.json(await stats()))
  .get('/searches', async (c) => {
    const q = LogQuerySchema.parse(c.req.query());
    const res = await es.search<SearchLog>({
      index: INDEX.searches,
      from: (q.page - 1) * PAGE_SIZE,
      size: PAGE_SIZE,
      track_total_hits: true,
      sort: [{ at: 'desc' }],
      query: logQuery(q),
    });
    const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
    return c.json({ items: res.hits.hits.map((h) => h._source!), total } satisfies Page<SearchLog>);
  })

  // ---------- Settings ----------
  .get('/settings', async (c) => c.json(await settingsView()))
  .put('/settings', async (c) => (await saveSettings(await c.req.json()), c.json(await settingsView())))

  .post('/reset', async (c) => (await seed({ force: true }), c.json({ ok: true })));

async function settingsView(): Promise<SettingsView> {
  const { settings, updatedAt } = await getSettings();
  return { settings, defaults: defaults(), updatedAt, apiKeyConfigured: !!config.anthropicKey, spentTodayUsd: await spentToday() };
}

function logQuery(q: LogQuery): estypes.QueryDslQueryContainer {
  const filter: estypes.QueryDslQueryContainer[] = [];
  const mustNot: estypes.QueryDslQueryContainer[] = [];
  if (q.q) filter.push({ simple_query_string: { query: q.q, fields: ['query', 'message', 'reply', 'unmatched', 'results.title.text'], default_operator: 'and' } });
  if (q.mode) filter.push({ term: { mode: q.mode } });
  if (q.level) filter.push({ term: { confidenceLevel: q.level } });
  if (q.interpreter) filter.push({ term: { interpreter: q.interpreter } });
  if (q.zeroExact) filter.push({ term: { zeroExact: q.zeroExact === 'true' } });
  if (q.feedback === 'none') mustNot.push(anyVote);
  else if (q.feedback) filter.push(voted(q.feedback));
  // `lte: day||/d` = through the end of that day (`+1d/d` would include the whole next day).
  if (q.from || q.to) filter.push({ range: { at: { gte: q.from, lte: q.to ? `${q.to}||/d` : undefined } } });
  return { bool: { filter, must_not: mustNot } };
}

const LEVEL_AGGS = {
  clicked: { filter: { exists: { field: 'clicks.tripId' } } },
  up: { filter: voted('up') },
  voted: { filter: anyVote },
};

async function stats(): Promise<SearchStats> {
  const res = await es.search({
    index: INDEX.searches,
    size: 0,
    track_total_hits: true,
    aggs: {
      assistant: { filter: { term: { mode: 'assistant' } } },
      zero: { filter: { term: { zeroExact: true } }, aggs: { clicked: { filter: { exists: { field: 'clicks.tripId' } } } } },
      clicked: { filter: { exists: { field: 'clicks.tripId' } } },
      // Confidence stats only cover searches that asked for something (older logs lack the flag: kept).
      levels: {
        filter: { bool: { must_not: { term: { hasCriteria: false } } } },
        aggs: { by: { terms: { field: 'confidenceLevel' }, aggs: LEVEL_AGGS } },
      },
      confidence: { filter: { bool: { must_not: { term: { hasCriteria: false } } } }, aggs: { avg: { avg: { field: 'confidence' } } } },
      up: { filter: voted('up') },
      down: { filter: voted('down') },
      latency: { percentiles: { field: 'latencyMs.total', percents: [50, 95] } },
      cost: { sum: { field: 'costUsd' } },
      unmatched: { terms: { field: 'unmatched', size: 10 } },
      // Classic text searches count too: "text searches that return nothing" is the problem in the brief.
      zeroQueries: { filter: { bool: { filter: [{ term: { zeroExact: true } }, { exists: { field: 'query.raw' } }] } }, aggs: { top: { terms: { field: 'query.raw', size: 10 } } } },
    },
  });
  // The ES client types aggregations loosely; this is the shape of the aggs requested above.
  const a = res.aggregations as unknown as {
    assistant: { doc_count: number };
    zero: { doc_count: number; clicked: { doc_count: number } };
    clicked: { doc_count: number };
    levels: { by: { buckets: { key: ConfidenceLevel; doc_count: number; clicked: { doc_count: number }; up: { doc_count: number }; voted: { doc_count: number } }[] } };
    confidence: { avg: { value: number | null } };
    up: { doc_count: number };
    down: { doc_count: number };
    latency: { values: Record<string, number | null> };
    cost: { value: number };
    unmatched: { buckets: { key: string; doc_count: number }[] };
    zeroQueries: { top: { buckets: { key: string; doc_count: number }[] } };
  };
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
  const share = (n: number) => (total ? n / total : 0);
  return {
    total,
    assistantShare: share(a.assistant.doc_count),
    zeroExactRate: share(a.zero.doc_count),
    avgConfidence: a.confidence.avg.value ?? 0,
    feedbackUp: a.up.doc_count,
    feedbackDown: a.down.doc_count,
    ctr: share(a.clicked.doc_count),
    rescueRate: a.zero.doc_count ? a.zero.clicked.doc_count / a.zero.doc_count : 0,
    byLevel: (['high', 'medium', 'low'] as const).map((level) => {
      const b = a.levels.by.buckets.find((x) => x.key === level);
      return { level, searches: b?.doc_count ?? 0, ctr: b?.doc_count ? b.clicked.doc_count / b.doc_count : 0, upRate: b?.voted.doc_count ? b.up.doc_count / b.voted.doc_count : null };
    }),
    latencyP50: Math.round(a.latency.values['50.0'] ?? 0),
    latencyP95: Math.round(a.latency.values['95.0'] ?? 0),
    totalCostUsd: a.cost.value,
    topUnmatched: a.unmatched.buckets.map((b) => ({ term: b.key, count: b.doc_count })),
    topZeroQueries: a.zeroQueries.top.buckets.map((b) => ({ message: b.key, count: b.doc_count })),
  };
}
