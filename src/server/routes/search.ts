import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { errors } from '@elastic/elasticsearch';
import { es, INDEX } from '../es.ts';
import { getMeta } from '../catalog.ts';
import { runSearch } from '../search/run.ts';
import { SearchRequestSchema } from '../search/state.ts';
import type { SearchRequest } from '../../shared/types.ts';

const ClickSchema = z.object({ tripId: z.number().int(), position: z.number().int().positive() });

const FeedbackSchema = z.object({
  vote: z.enum(['up', 'down']),
  tripId: z.number().int().optional(),
  comment: z.string().trim().max(1000).optional(),
});

export const searchRoutes = new Hono()
  .get('/meta', async (c) => c.json(await getMeta()))

  .post('/search', async (c) => {
    const req = SearchRequestSchema.parse(await c.req.json()) as SearchRequest;
    const { response } = await runSearch(req);
    return c.json(response);
  })

  .post('/searches/:id/click', async (c) => {
    const click = ClickSchema.parse(await c.req.json());
    const source = `
      boolean exact = false;
      for (r in ctx._source.results) { if (r.tripId == params.tripId) { exact = r.exact; } }
      if (ctx._source.clicks == null) { ctx._source.clicks = []; }
      ctx._source.clicks.add(['tripId': params.tripId, 'position': params.position, 'exact': exact, 'at': params.at]);`;
    return updateLog(c.req.param('id'), source, { ...click, at: new Date().toISOString() }, c);
  })

  .post('/searches/:id/feedback', async (c) => {
    const fb = FeedbackSchema.parse(await c.req.json());
    // Search-level vote/comment, or a per-trip vote (latest vote per trip wins).
    const source = `
      if (params.tripId == null) {
        ctx._source.feedback.vote = params.vote;
        if (params.comment != null) { ctx._source.feedback.comment = params.comment; }
      } else {
        ctx._source.feedback.results.removeIf(r -> r.tripId == params.tripId);
        ctx._source.feedback.results.add(['tripId': params.tripId, 'vote': params.vote]);
      }`;
    return updateLog(c.req.param('id'), source, { vote: fb.vote, tripId: fb.tripId ?? null, comment: fb.comment ?? null }, c);
  });

async function updateLog(id: string, source: string, params: Record<string, unknown>, c: Context) {
  try {
    await es.update({ index: INDEX.searches, id, retry_on_conflict: 3, script: { source, params } });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof errors.ResponseError && err.statusCode === 404) return c.json({ error: 'search not found' }, 404);
    throw err;
  }
}
