# AGENTS.md — WeRoad Trip Assistant

Context for AI coding agents (Claude Code reads it through `CLAUDE.md`). Humans: start with `README.md`, then `docs/DECISIONS.md`.

## What this is

A search-page assistant for WeRoad (small-group trips). The user starts from a classic search (text, dates, filters), then refines it in natural language over several turns. Every search is logged with a confidence score, visitors leave feedback, and `/admin` manages trips, FAQs and the search log. The brief is in `REQUIREMENTS.md`.

Non-negotiables (from the brief, enforced in code and tests):
1. **Sold-out departures are never shown.** Bookable = status in `BOOKABLE_STATUSES` and `seatsLeft > 0` and departure after today. Enforced in the ES query and again in `match.ts`.
2. **Zero results is not a dead end.** If nothing matches every constraint, show the closest trips and say exactly what differs.
3. **Be honest.** Every result has a confidence and ✓/✗ reasons; every search has an overall confidence; requests we can't map to data are listed as `unmatched`, never silently dropped.

## Stack

- TypeScript everywhere, Node 24 runs `.ts` directly (type stripping, no build step for the server). Use `.ts` extensions in imports, `import type` for types, no enums/namespaces/parameter properties (`erasableSyntaxOnly`).
- API: Hono (`src/server`). SPA: React 19 + Vite (`src/web`), plain CSS with WeRoad tokens. Shared contract: `src/shared/types.ts`.
- Data: Elasticsearch 9.5 is the only store (trips, faqs, searches). Kibana on top of the `searches` index.
- Semantic search: local embeddings (`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`), 384-dim `dense_vector`.
- LLM: Claude via `@anthropic-ai/sdk`, structured outputs (`messages.parse` + zod). Model from `ANTHROPIC_MODEL`. Without a key, a rule-based parser takes over.

## Layout

```
src/shared/types.ts        API + domain contract (single source of truth)
src/shared/examples.ts     demo search scripts shown in the UI ("Try an example")
src/server/index.ts        Hono app: routes, static SPA, boot (wait for ES, seed if empty)
src/server/config.ts       env + pricing table
src/server/es.ts           ES client, index mappings, synonyms
src/server/embeddings.ts   local embedding model
src/server/catalog.ts      trips/faqs validation + CRUD + vocabulary (CatalogMeta)
src/server/seed.ts         loads samples/, fixes data, shifts dates, indexes
src/server/search/         the search pipeline (see below)
src/server/routes/         HTTP layer only, no business logic
src/web/                   SPA: search page (/) and admin (/admin)
eval/                      offline eval: cases + runner (quality, latency, cost)
```

## Search pipeline (`src/server/search/`)

`run.ts` orchestrates one turn: `interpret` → `retrieve` → `match` → `confidence` → log.

1. **interpret.ts** — NL message + current state → new state. Claude returns the full new `SearchState`, a short reply, `unmatched` requirements, and (if the user asked a question) an answer grounded only in the FAQ candidates retrieved for that message (cited ids are checked). Output is validated and normalized against the catalog vocabulary. Falls back to **rules.ts** on missing key, timeout (10 s), refusal, invalid output or the daily LLM budget. **LLM schema rule:** every field required, empty value = unset; never optional/nullable (the API caps unions at 16 and optionals make the grammar compile for 90 s+). Bump `PROMPT_VERSION` when the prompt or schema changes.
2. **retrieve.ts** — two ES queries in parallel, merged: *strict* (every hard constraint as a filter, incl. nested bookable departures) and *relaxed* (bookable only). Both score free text with BM25 (`_name: lexical`), per-word queries (`term:i`, for coverage) and kNN (`_name: semantic`) via `include_named_queries_score`.
3. **match.ts** — pure functions: per-constraint penalties growing with distance, best departure per trip, ✓/✗ reasons, relaxation notes. Hard constraints decide "exact"; soft ones (age band) only rank.
4. **confidence.ts** — pure functions: result confidence = constraint match × relevance (lexical coverage + calibrated semantic + moods); search confidence = understanding × top results quality. Free text decides exactness only when the catalog clearly has that topic.
5. **faq.ts** — FAQ retrieval (BM25 + kNN). Destination articles are only eligible for destinations in the search or named in the message. Also the "good to know" FAQ on each card.
6. **suggest.ts** — "Narrow it down" facets (region, month, vibe, length, budget) for broad searches.

## HTTP API

Public:
- `GET  /api/meta` → `CatalogMeta`
- `POST /api/search` (`SearchRequest`) → `SearchResponse`. No `message` = classic search (no LLM).
- `POST /api/searches/:id/feedback` (`FeedbackRequest`) → `{ ok: true }`
- `POST /api/searches/:id/click` (`ClickRequest`) → `{ ok: true }` — a visitor opened a trip (CTR, rescue rate)

Demo scripts (`src/shared/examples.ts`) are imported by the SPA directly; no endpoint.

Admin (no auth — demo only):
- `GET /api/admin/trips?q=` → `Trip[]`, `GET /api/admin/trips/:id` → `Trip & { faqs: Faq[] }`
- `POST /api/admin/trips` (Trip without id → id assigned), `PUT /api/admin/trips/:id`, `DELETE /api/admin/trips/:id`
- `GET /api/admin/faqs?destination=` → `Faq[]`, `POST /api/admin/faqs`, `PUT /api/admin/faqs/:id`, `DELETE /api/admin/faqs/:id`
- `GET /api/admin/searches?<SearchLogQuery>` → `Page<SearchLog>`, `GET /api/admin/searches/stats` → `SearchStats`
- `POST /api/admin/reset` → reseeds trips and FAQs from `samples/` (search log kept)

Errors: `{ error: string, details?: unknown }` with 400 (validation) / 404 / 500.

## Design system (copied from weroad.com CSS variables)

Font `Google Sans` (fallback system sans). Text `#262626`, muted `#737373`, borders `#e5e5e5`, page bg `#f5f5f5`, elevated `#fafafa`.
Primary `#ff4758` (hover `#f51f47`), secondary teal `#418089` (hover `#2f7580`, light bg `#f2f9f9`), highlight/AI violet `#6360ff` (light `#f6f8fd`), success `#10b981`, warning `#f59e0b`, error `#ef4444`.
Buttons and pills: radius 6px, 14-16px medium. Cards: square image area radius 12px, title 16px/600, price teal 14px/600, discount badge teal on `#f2f9f9` radius 4px. Headings bold 24-30px. Container max width 74.5rem, 1rem padding.

## Conventions

- Keep it small and readable: no abstractions without a second user, no comments that repeat the code, comments explain *why*.
- Business rules live in pure functions with unit tests (`*.test.ts` next to the file, vitest). Routes stay thin.
- Validate every input at the boundary with zod (`catalog.ts` schemas, `search/state.ts`).
- Never trust LLM output: parse with the schema, then `toState` → `SearchStateSchema` → `normalizeState` against the catalog vocabulary.
- Every search log carries `version` (commit + `PROMPT_VERSION`), so behaviour changes can be compared in /admin or Kibana.
- Adding a search dimension: follow the `add-search-filter` skill. Changing search behaviour: run the `run-eval` skill.
- Don't add dependencies without saying why in the PR/commit message.

## Commands

```
npm run es:up        # Elasticsearch + Kibana in Docker
npm run dev          # API on :3000 (seeds on first boot) + Vite on :5173
npm test             # unit tests
npm run typecheck
npm run eval         # offline eval against the running ES (uses the LLM if ANTHROPIC_API_KEY is set)
npm run seed         # force reseed from samples/
docker compose up --build   # everything, app on :3000, Kibana on :5601
```

## Verifying a change

1. `npm run typecheck && npm test`
2. If search behaviour changed: `npm run eval` and compare with the last run in `eval/results/`.
3. If UI changed: open http://localhost:5173, run one example from "Try an example", check the admin search log shows it.
