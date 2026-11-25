# WeRoad Trip Assistant

An assistant that lives on WeRoad's search page. It starts from the visitor's classic search (text, dates, filters), lets them refine it in their own words over several turns, never shows sold-out departures, and turns "no results" into the closest options with an honest confidence score and the reason each trip does or doesn't fit.

- **Search page** `/` — classic search + filters, the assistant panel, "Try an example" scripts, per-trip and per-search feedback.
- **Backoffice** `/admin` — search log with filters and quality stats, CRUD for trips and FAQs, link to Kibana.
- **Why it is built this way:** [`docs/DECISIONS.md`](docs/DECISIONS.md). **How it was built with AI agents:** [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md). **Context for coding agents:** [`AGENTS.md`](AGENTS.md).

## Run it

Requirements: Docker. Optional: an Anthropic API key (without it, a rule-based parser reads the messages and confidence is lowered accordingly).

```bash
cp .env.example .env   # then set ANTHROPIC_API_KEY
docker compose up --build
```

- App: http://localhost:3000 · Backoffice: http://localhost:3000/admin · Kibana: http://localhost:5601 (data view "Search log" is created automatically)
- On first boot the app creates the indices, loads `samples/` (fixing missing continents and shifting departure dates so they are in the future) and computes embeddings. Reset any time from the backoffice.

## Develop

Requirements: Node 24+ (runs the TypeScript server directly, no build step), Docker for Elasticsearch.

```bash
npm install
npm run es:up      # Elasticsearch :9200 + Kibana :5601
npm run dev        # API :3000 (seeds on first boot) + Vite :5173 with hot reload
```

```bash
npm test           # unit tests (business rules: bookability, penalties, confidence, parser)
npm run typecheck
npm run eval -- --rules         # offline eval with the rule-based parser (free)
npm run eval -- --save          # offline eval with Claude, saved to eval/results/
```

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables the LLM interpreter |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | See the model comparison in `docs/DECISIONS.md` |
| `LLM_TIMEOUT_MS` | `10000` | After this the rule-based parser answers |
| `DAILY_LLM_BUDGET_USD` | `5` | Past this, the assistant uses the rule-based parser |
| `ES_URL` | `http://localhost:9200` | |
| `KIBANA_URL` | – | Public Kibana URL linked from `/admin` |
| `SHIFT_DATES` | `true` | Shift sample departures relative to today |
| `APP_TODAY` | today (UTC) | Pin "today" for reproducible demos |

## Repository map

```
src/shared/      API contract + demo scripts, imported by server and SPA
src/server/      Hono API: search pipeline (search/), routes, Elasticsearch, seed
src/web/         React SPA: search page and backoffice
eval/            offline eval: scripted conversations with expectations
.claude/         skills (add-search-filter, run-eval) and a review subagent
docs/            decisions, AI workflow
```
