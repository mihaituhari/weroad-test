import { Hono } from 'hono';
import type { estypes } from '@elastic/elasticsearch';
import { es, INDEX } from '../es.ts';
import { deleteFaq, deleteTrip, getTrip, listFaqs, listTrips, nextId, saveFaq, saveTrip } from '../catalog.ts';
import { seed } from '../seed.ts';
import type { ConfidenceLevel, Page, SearchLog, SearchLogQuery, SearchStats } from '../../shared/types.ts';

// Backoffice API. No auth: demo only (see docs/DECISIONS.md).

const PAGE_SIZE = 25;
const id = (raw: string) => Number(raw);

export const adminRoutes = new Hono()
  // ---------- Trips ----------
  .get('/trips', async (c) => c.json(await listTrips(c.req.query('q') || undefined)))
  .get('/trips/:id', async (c) => {
    const trip = await getTrip(id(c.req.param('id')));
    if (!trip) return c.json({ error: 'trip not found' }, 404);
    return c.json({ ...trip, faqs: await listFaqs(trip.destination) });
  })
  .post('/trips', async (c) => c.json(await saveTrip({ ...(await c.req.json()), id: await nextId(INDEX.trips) }), 201))
  .put('/trips/:id', async (c) => c.json(await saveTrip({ ...(await c.req.json()), id: id(c.req.param('id')) })))
  .delete('/trips/:id', async (c) => (await deleteTrip(id(c.req.param('id'))), c.json({ ok: true })))

  // ---------- FAQs ----------
  .get('/faqs', async (c) => c.json(await listFaqs(c.req.query('destination') || undefined)))
  .post('/faqs', async (c) => c.json(await saveFaq({ ...(await c.req.json()), id: await nextId(INDEX.faqs) }), 201))
  .put('/faqs/:id', async (c) => c.json(await saveFaq({ ...(await c.req.json()), id: id(c.req.param('id')) })))
  .delete('/faqs/:id', async (c) => (await deleteFaq(id(c.req.param('id'))), c.json({ ok: true })))

  // ---------- Search log ----------
  .get('/searches/stats', async (c) => c.json(await stats()))
  .get('/searches', async (c) => {
    const q = c.req.query() as Record<keyof SearchLogQuery, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1));
    const res = await es.search<SearchLog>({
      index: INDEX.searches,
      from: (page - 1) * PAGE_SIZE,
      size: PAGE_SIZE,
      track_total_hits: true,
      sort: [{ at: 'desc' }],
      query: logQuery(q),
    });
    const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
    return c.json({ items: res.hits.hits.map((h) => h._source!), total } satisfies Page<SearchLog>);
  })

  .post('/reset', async (c) => (await seed({ force: true }), c.json({ ok: true })));

function logQuery(q: Record<keyof SearchLogQuery, string | undefined>): estypes.QueryDslQueryContainer {
  const filter: estypes.QueryDslQueryContainer[] = [];
  const mustNot: estypes.QueryDslQueryContainer[] = [];
  if (q.q) filter.push({ simple_query_string: { query: q.q, fields: ['message', 'reply', 'unmatched', 'results.title'], default_operator: 'and' } });
  if (q.mode) filter.push({ term: { mode: q.mode } });
  if (q.level) filter.push({ term: { confidenceLevel: q.level } });
  if (q.interpreter) filter.push({ term: { interpreter: q.interpreter } });
  if (q.zeroExact) filter.push({ term: { zeroExact: q.zeroExact === 'true' } });
  if (q.feedback === 'none') mustNot.push({ exists: { field: 'feedback.vote' } });
  else if (q.feedback) filter.push({ term: { 'feedback.vote': q.feedback } });
  if (q.from || q.to) filter.push({ range: { at: { gte: q.from, lte: q.to ? `${q.to}||+1d/d` : undefined } } });
  return { bool: { filter, must_not: mustNot } };
}

async function stats(): Promise<SearchStats> {
  const res = await es.search({
    index: INDEX.searches,
    size: 0,
    track_total_hits: true,
    aggs: {
      assistant: { filter: { term: { mode: 'assistant' } } },
      zero: { filter: { term: { zeroExact: true } }, aggs: { clicked: { filter: { exists: { field: 'clicks.tripId' } } } } },
      clicked: { filter: { exists: { field: 'clicks.tripId' } } },
      levels: {
        terms: { field: 'confidenceLevel' },
        aggs: {
          clicked: { filter: { exists: { field: 'clicks.tripId' } } },
          up: { filter: { term: { 'feedback.vote': 'up' } } },
          voted: { filter: { exists: { field: 'feedback.vote' } } },
        },
      },
      confidence: { avg: { field: 'confidence' } },
      votes: { terms: { field: 'feedback.vote' } },
      latency: { percentiles: { field: 'latencyMs.total', percents: [50, 95] } },
      cost: { sum: { field: 'costUsd' } },
      unmatched: { terms: { field: 'unmatched', size: 10 } },
      zeroQueries: { filter: { bool: { filter: [{ term: { zeroExact: true } }, { exists: { field: 'message.raw' } }] } }, aggs: { top: { terms: { field: 'message.raw', size: 10 } } } },
    },
  });
  // The ES client types aggregations loosely; this is the shape of the aggs requested above.
  const a = res.aggregations as unknown as {
    assistant: { doc_count: number };
    zero: { doc_count: number; clicked: { doc_count: number } };
    clicked: { doc_count: number };
    levels: { buckets: { key: ConfidenceLevel; doc_count: number; clicked: { doc_count: number }; up: { doc_count: number }; voted: { doc_count: number } }[] };
    confidence: { value: number | null };
    votes: { buckets: { key: string; doc_count: number }[] };
    latency: { values: Record<string, number | null> };
    cost: { value: number };
    unmatched: { buckets: { key: string; doc_count: number }[] };
    zeroQueries: { top: { buckets: { key: string; doc_count: number }[] } };
  };
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
  const share = (n: number) => (total ? n / total : 0);
  const votes = (k: string) => a.votes.buckets.find((b) => b.key === k)?.doc_count ?? 0;
  return {
    total,
    assistantShare: share(a.assistant.doc_count),
    zeroExactRate: share(a.zero.doc_count),
    avgConfidence: a.confidence.value ?? 0,
    feedbackUp: votes('up'),
    feedbackDown: votes('down'),
    ctr: share(a.clicked.doc_count),
    rescueRate: a.zero.doc_count ? a.zero.clicked.doc_count / a.zero.doc_count : 0,
    byLevel: (['high', 'medium', 'low'] as const).map((level) => {
      const b = a.levels.buckets.find((x) => x.key === level);
      return { level, searches: b?.doc_count ?? 0, ctr: b?.doc_count ? b.clicked.doc_count / b.doc_count : 0, upRate: b?.voted.doc_count ? b.up.doc_count / b.voted.doc_count : null };
    }),
    latencyP50: Math.round(a.latency.values['50.0'] ?? 0),
    latencyP95: Math.round(a.latency.values['95.0'] ?? 0),
    totalCostUsd: a.cost.value,
    topUnmatched: a.unmatched.buckets.map((b) => ({ term: b.key, count: b.doc_count })),
    topZeroQueries: a.zeroQueries.top.buckets.map((b) => ({ message: b.key, count: b.doc_count })),
  };
}
