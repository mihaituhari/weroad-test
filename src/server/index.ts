import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { config } from './config.ts';
import { waitForEs } from './es.ts';
import { seed } from './seed.ts';
import { embedOne } from './embeddings.ts';
import { provisionKibana } from './kibana.ts';
import { searchRoutes } from './routes/search.ts';
import { adminRoutes } from './routes/admin.ts';

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: 'invalid request', details: err.issues }, 400);
  if (err instanceof SyntaxError) return c.json({ error: 'invalid JSON body' }, 400);
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));
// Trips are the biggest legitimate bodies (~10 KB); anything far larger is a mistake or abuse.
app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'request body too large' }, 413) }));
app.route('/api', searchRoutes);
app.route('/api/admin', adminRoutes);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

// Production: the built SPA. Every non-API path gets index.html (client-side pages: / and /admin).
app.use('/*', serveStatic({ root: './dist/web' }));
app.get('/*', serveStatic({ path: './dist/web/index.html' }));

console.log(`[boot] waiting for Elasticsearch at ${config.esUrl}`);
await waitForEs();
console.log('[boot] Elasticsearch ready, checking the catalog');
if (await seed()) console.log('[boot] seeded trips and FAQs from samples/');
console.log('[boot] loading the embedding model');
await embedOne('warm up'); // load the embedding model before the first visitor
void provisionKibana();

serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(`API on http://localhost:${port}`));
