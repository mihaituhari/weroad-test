import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { errors } from '@elastic/elasticsearch';
import { es, INDEX } from '../es.ts';
import { getMeta } from '../catalog.ts';
import { runSearch } from '../search/run.ts';
import { redact, SearchRequestSchema } from '../search/state.ts';
import type { SearchRequest } from '../../shared/types.ts';

// Assistant turns call the LLM: a per-visitor limit keeps one script from burning the daily budget.
const TURNS_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60_000;
const turns = new Map<string, number[]>();
function allowTurn(visitor: string) {
  const now = Date.now();
  if (turns.size > 10_000) turns.clear(); // in-memory and best effort: never let it grow unbounded
  const recent = (turns.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= TURNS_PER_WINDOW) return false;
  turns.set(visitor, [...recent, now]);
  return true;
}
const visitorOf = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';

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
    if (req.message && !allowTurn(visitorOf(c))) return c.json({ error: 'Too many assistant messages, please wait a few minutes.' }, 429);
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
    return updateLog(c.req.param('id'), source, { vote: fb.vote, tripId: fb.tripId ?? null, comment: fb.comment ? redact(fb.comment) : null }, c);
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
