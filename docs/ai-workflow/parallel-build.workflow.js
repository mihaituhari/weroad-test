export const meta = {
  name: 'weroad-parallel-build',
  description: 'Build search UI, admin UI and eval set in parallel against the shared contract, plus a 3-lens blind-spot review',
  phases: [
    { title: 'Build', detail: 'search page, admin page, eval harness (disjoint files)' },
    { title: 'Critique', detail: 'product, AI stack, engineering/ops blind spots' },
  ],
}

const ROOT = '<repo>'

const COMMON = `
You are working in ${ROOT}, a TypeScript project for a WeRoad (small-group travel) hiring test.
Read FIRST: ${ROOT}/AGENTS.md (architecture, API, design tokens, conventions), ${ROOT}/REQUIREMENTS.md, ${ROOT}/src/shared/types.ts (the contract — do NOT modify), ${ROOT}/src/shared/examples.ts.
Other people are writing other files in this repo at the same time. Rules:
- Only create/edit the files you own (listed below). Do NOT touch package.json, tsconfig.json, vite.config.ts, src/shared/*, src/server/*, src/web/main.tsx, src/web/api.ts or other agents' folders.
- No new npm dependencies. Deps available: react 19, react-dom, zod, vite. No UI kit, no router, no CSS framework.
- Node 24 + TS with allowImportingTsExtensions: always import with explicit .ts/.tsx extensions, use "import type" for types, no enums.
- Code style: efficient, not verbose. Small focused components, no premature abstraction, comments only for the why. A human must find it easy to read and modify.
- To typecheck run: cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E '<your paths>' — other folders may have errors while they are in progress; only your files must be clean.
- If the contract (types.ts / api.ts) is missing something you need, do not change it: work around it minimally and report it in your final answer.
Final answer: list files written, what you verified (typecheck/build output), and any contract gaps or follow-ups. Keep it under 250 words.
`

const DESIGN = `
Design: replicate weroad.com's look (we extracted their CSS variables). Font "Google Sans", system sans fallback. Page bg #f5f5f5, surfaces white, borders #e5e5e5, text #262626 / muted #737373.
Primary red #ff4758 (hover #f51f47) for main CTAs. Secondary teal #418089 (hover #2f7580, tint #f2f9f9) for prices, discount badges, outlined suggestion chips. AI/assistant accent violet #6360ff (tint #f6f8fd, border #c2cdff) — weroad.com uses it for their "Describe your trip" AI button with a sparkle icon.
Success #10b981 (tint #d1fae5), warning #f59e0b (tint #fef3c7), error #ef4444 (tint #fee2e2).
Buttons/pills: border 1px #e5e5e5, radius 6px, padding 6px 16px, 14-16px weight 500, white bg. Their search page has a top bar with "Where?" and "When?" inputs side by side in one bordered box, then a row of filter pills ("Age range ▾", "Price ▾", "Duration ▾", "Physical effort ▾", "Trip type ▾", "Filters").
Trip cards: square image area (aspect-ratio 1) radius 12px with white overlay text at the bottom ("5 days" left, "★ 4.6" right, 14px/600) and white pill chips top-left; below: title 16px/600 #262626, then "From" muted 14px and price teal 14px/600 + strikethrough base price muted + discount badge (teal text on #f2f9f9, radius 4px, 14px/700, "-13%"). Section headings 24-30px bold.
Container max-width 74.5rem with 1rem side padding. Mobile-friendly (single column under 720px).
We have no photos: the image area is a gradient per continent (pick 6 tasteful gradients) with the destination label large in white.
`

const SEARCH_UI = `${COMMON}
You own: ${ROOT}/src/web/styles.css (global: CSS tokens as :root variables, base, header .site-header/.logo/.logo__we (primary red)/.logo__road (#404040)/.site-nav, buttons, pills, chips, badges, utility classes) and everything under ${ROOT}/src/web/search/ (SearchPage.tsx is imported by main.tsx as { SearchPage }).
${DESIGN}
Build the public search page. It calls the API via the existing ${ROOT}/src/web/api.ts (api.meta, api.search, api.feedback). The server may not be running while you work — build against the contract.

Product requirements (from the client brief, all must be visible in the UI):
- Classic WeRoad-like search: "Where / what?" free-text input, "When?" two date inputs (departure from / to), Search button (primary). Filter pills (use <details> popovers, closes on outside click is nice-to-have): Budget (max €), Duration (min/max days), Physical effort (LOW/MEDIUM/HIGH, labels Easy/Moderate/Challenging), Trip type (meta.travelTypes), Continent (meta.continents), Destination (meta.destinations), Age range (meta.ageBands), and a "More" pill with toggles Women only / Private room / Confirmed departures only / Group size (minSeats). Sort select (Best match / Price / Soonest).
- Every field of SearchState currently applied is shown as a removable chip (including ones only the assistant sets: mustHave "Must include: cooking class", moods "Vibe: party", returnBy "Back by 24 Oct", text). Removing a chip or changing a filter = classic search (POST /api/search without message).
- An assistant panel lives ON the search page (right column, sticky, ~360px on desktop; collapsible bottom panel on mobile), title "✨ Trip assistant", subtitle "Refine your search in your own words". It starts from the current search state. Each message → api.search({sessionId, state, message, history}) and the returned state replaces the page state, so filters/chips update. Show user bubbles and assistant replies (response.reply). If response.answer exists, render it as an FAQ answer box with source links (answer.faqs[].url). Show "Thinking…" while waiting. "Start over" resets state + conversation. Send the last 6 turns as history. sessionId = crypto.randomUUID() kept in sessionStorage.
- "Try an example" — collapsed by default (<details>), lists EXAMPLES from src/shared/examples.ts (label + small 'shows' text). Clicking one: reset, set state = example.start, run a classic search, then send each turn sequentially through the assistant (awaiting each), so the visitor watches the conversation unfold.
- Results: count + overall confidence banner from response.confidence: level colour (high=success, medium=warning, low=error tints), "87% confident", the explanation text, and a small "How we scored this" disclosure showing understanding % and match quality %. If response.relaxed is non-empty: a notice "No trip matches everything. Closest options below — we loosened: <notes>". If response.unmatched non-empty: "We couldn't find trips for: …". Never hide low confidence.
- Result cards (grid, 2-3 columns next to the assistant): gradient tile with destination label, top-left badge "92% match" coloured by confidence (>=0.75 success, >=0.5 warning, else error) and a "Closest option" badge when !exact; bottom overlay "N days" and "★ rating" (or "New" if no rating). Title links to trip.url (target _blank). Price block as on weroad (fromPrice, discount computed from the first departure basePriceEur). Up to 3 departures: "12 Dec – 24 Dec · €1,290 · <status> · 3 seats left" with status labels PLANNED "Open to book", ALMOST_CONFIRMED "Almost confirmed", CONFIRMED "Confirmed" (success colour), ALMOST_FULL "Last spots" (primary colour). Reasons list (✓ in success colour / ✗ in error colour, compact 13px). "Good to know: <goodToKnow.title>" link if present. Per-card 👍/👎 (api.feedback with tripId) with a selected state.
- Search-level feedback under the results: "Were these results useful? 👍 👎", after a vote an optional comment box + send, then "Thanks — this helps us improve". Feedback is tied to response.searchId (reset on each new search).
- On first load: api.meta() and a classic search with empty state (shows everything bookable).
- Loading skeleton/opacity and an error message if the API fails.
Keep the total code lean: roughly SearchPage.tsx (state + orchestration), Filters.tsx, ResultCard.tsx, Assistant.tsx, plus small helpers (format.ts) — your call. Verify with: npx tsc --noEmit filtered to src/web/search and styles, and npx vite build (the build includes admin files written by another agent; if the build fails only because of src/web/admin, say so).
`

const ADMIN_UI = `${COMMON}
You own everything under ${ROOT}/src/web/admin/ (AdminPage.tsx is imported by main.tsx as { AdminPage }; put admin-only styles in src/web/admin/admin.css imported from AdminPage.tsx). Global styles, header and tokens live in src/web/styles.css (owned by another agent, in progress) — use CSS variables named like --wr-primary, --wr-secondary, --wr-highlights, --wr-border, --wr-bg, --wr-text, --wr-muted, --wr-success, --wr-warning, --wr-error with fallbacks, e.g. var(--wr-primary, #ff4758).
${DESIGN}
Build the backoffice at /admin. API driven via the existing ${ROOT}/src/web/api.ts (api.admin.*, api.meta). No auth (demo).
- Header row: title "Backoffice", right side: "Open Kibana ↗" link (meta.kibanaUrl, hidden if null, target _blank) and "Reset demo data" button (window.confirm first; calls api.admin.reset()).
- Tabs: Searches (default) | Trips | FAQs. Keep the active tab in location.hash (#searches/#trips/#faqs).
- Searches tab: stats cards from api.admin.stats(): total searches, assistant share %, zero-exact rate %, avg confidence %, feedback 👍/👎, latency p50/p95 ms, total LLM cost $ (4 decimals). Two small lists: "Unmatched requests" (topUnmatched) and "Zero-result queries" (topZeroQueries) — these are the inputs to improve the algorithm, say so in a hint. Filter bar mapping SearchLogQuery: text q, mode (any/classic/assistant), confidence level, zero exact (any/yes/no), feedback (any/up/down/none), interpreter (any/llm/rules/none), from/to dates. Table: time (local, short), mode, message (or a one-line summary of stateOut when no message), interpreter, results "exact/total", confidence badge (level colour), feedback icon, latency ms, cost. Click a row to expand details: message, reply, unmatched, relaxed, results list (title, confidence %, exact), stateIn vs stateOut as pretty JSON side by side, tokens, cost, error, feedback comment & per-result votes. Pagination 25/page (Page.total).
- Trips tab: search box (api.admin.trips(q)), table: id, title, destination, continent, days, bookable departures count (status in BOOKABLE_STATUSES, seatsLeft>0, startingDate > today), from price (min bookable priceEur), rating. "New trip" button. Row click → editor.
  Editor (same component for create/edit): fields title, slug, url, destination (input + datalist from meta.destinations), continent (input + datalist), destinationLabel, numberOfDays, startingPlace, endingPlace, travelStyle, travelTypes (comma separated), moods (5 number inputs 0-100), physicalRating select, shortDescription, description (textarea), rating value + count (empty = null). Departures: editable table (id, startingDate, endingDate, priceEur, basePriceEur, salesStatus select of SALES_STATUSES, seatsLeft, maxPax, paxBooked, ageBand, isConfirmed, privateRoomBookable, isWomenOnly) with add/remove row; a sold-out/non-bookable row is shown greyed with a hint "not shown to visitors". Itinerary as a JSON textarea validated with JSON.parse on save. When editing, show "Related FAQs" (from api.admin.trip(id).faqs) with a link that opens the FAQ tab editor for it. Save (create → createTrip without id, edit → updateTrip), Delete (confirm), Cancel. Show API validation errors (Error.message) inline.
- FAQs tab: destination filter (select from meta.destinations + "General"), table: id, scope, destination, title, and "linked trips" count (trips with that destination, from the trips list). Editor: title, body (textarea), scope select (general/destination), destination select (meta.destinations, required when scope=destination, null otherwise), url. Create/update/delete as above.
- After any write, refetch the list. Use simple controlled forms; a tiny generic <Field> helper is fine. Keep it compact: e.g. AdminPage.tsx, SearchesTab.tsx, TripsTab.tsx (incl. editor), FaqsTab.tsx, admin.css.
Verify with npx tsc --noEmit filtered to src/web/admin.
`

const EVAL = `${COMMON}
You own ${ROOT}/eval/cases.ts and ${ROOT}/eval/run.ts (and ${ROOT}/eval/README.md, short).
Goal: an offline eval that measures quality, latency and cost of the search assistant, runnable as "npm run eval" (node eval/run.ts). It must be the evidence we show reviewers ("how you measure quality, cost and latency").

Study the data first: ${ROOT}/samples/trips.json (50 trips, each with 10 departures/tours) and ${ROOT}/samples/faqs.json. Important data facts:
- At seed time continents missing in the data are backfilled (e.g. Vietnam, Thailand, Indonesia, Philippines -> Asia; Morocco, Egypt, Tunisia, Madagascar -> Africa; Iceland, Sweden, Denmark, Latvia, Turkey -> Europe; Puerto Rico, Dominican Republic -> America).
- At seed time all departure dates are shifted forward by the number of days between 2026-10-16 (export date) and today, so the catalog stays in the future. So do NOT hardcode trip ids for date-dependent cases; for those, assert the parsed state (departFrom/departTo/returnBy month/day) instead.
- Bookable = salesStatus in PLANNED, ALMOST_CONFIRMED, CONFIRMED, ALMOST_FULL and seatsLeft > 0 and startingDate > today. No departure has isWomenOnly=true, so a women-only request must yield zero exact results.
- Grep the trip texts (title, description, shortDescription, itinerary titles/highlights) to pick expected trip ids for keyword/semantic cases (e.g. which trips mention a cooking class, northern lights, safari, Christmas markets).

The pipeline entry point (being written right now by someone else, at src/server/search/run.ts) has exactly this signature:
  export async function runSearch(req: SearchRequest, opts?: { log?: boolean; forceRules?: boolean; model?: string }): Promise<{ response: SearchResponse; log: SearchLog }>
Types are in src/shared/types.ts. log:false means "don't write to the search log index". forceRules:true skips the LLM (rule-based parser). The SearchLog it returns contains latencyMs, tokens and costUsd.
Also importable: "import { today } from '../src/server/config.ts'" and "import { BOOKABLE_STATUSES } from '../src/shared/types.ts'".

eval/cases.ts: export interface EvalCase { id: string; tags: string[]; start?: SearchState; turns: string[]; expect: Expect } with Expect = {
  state?: Partial<SearchState>  // fields the final state must contain: arrays = expected items must be included (case-insensitive), numbers = within ±10%, dates = exact string, booleans exact, moods = expected keys present with value >= 0.5
  topAnyOf?: number[]           // at least one of these trip ids in the top 3 results
  noneOf?: number[]             // none of these trip ids anywhere in results
  minExact?: number
  zeroExact?: boolean           // exactCount must be 0 (and results must still be non-empty: no dead end)
  maxConfidence?: number        // overall confidence.score must be <= this (honesty cases)
  minConfidence?: number
  answerFaqAnyOf?: number[]     // response.answer.faqs must include one of these ids
  unmatched?: boolean           // response.unmatched must be non-empty
}
Write ~30 cases covering: single destination, continent incl. a backfilled one, month and date-window phrasing ("I only have 19-24 October", "in March", "next summer"), budget, duration ("a weekend", "two weeks"), travel types, moods/vibes ("party", "relax"), age ("I'm 23"), physical effort, group size ("we are 4"), mustHave ("with a cooking class"), synonyms ("aurora"), typos ("Japn"), semantic-only ("sushi and temples" → Japan), FAQ questions (flights included? currency in Peru? plugs in Japan?), multi-turn refinements (2-3 turns where later turns narrow or change earlier ones, e.g. "Asia" → "actually Europe"), unknown destination ("Antarctica"), women-only (zeroExact), impossible budget ("under 100 euros": zeroExact, low confidence). Tag each case (e.g. 'dates','budget','faq','multi-turn','honesty','semantic').
  Each turn simulates the UI: start = initial state run as a classic search (no message) if provided, then each turn is sent with message, the state returned by the previous step, and history (user/assistant turns so far, assistant text = previous response.reply).

eval/run.ts: CLI flags --rules (forceRules), --model <id>, --only <id or tag>, --save (write JSON). For each case run the turns sequentially via runSearch(..., { log: false, ... }). Score every expectation as a separate check. ALSO for every case and turn run a hard safety check: every departure in every result is bookable (status in BOOKABLE_STATUSES, seatsLeft > 0, startingDate > today()) — count any violation as a "sold-out leak" (must be 0) and fail. Also check no dead end: results.length > 0.
Print a compact table (case id, pass/fail, failed checks, confidence, exact/total, interpreter, ms, $) and a summary: case pass rate, check pass rate by tag, state-field accuracy, top-3 hit rate, sold-out leaks, dead ends, interpreter fallback count, latency p50/p95 per turn, total cost and cost per turn. With --save write eval/results/<YYYY-MM-DD>-<model or rules>.json (summary + per-case details). Exit code 1 if any sold-out leak or dead end. Keep run.ts readable (~150-200 lines). Use plain console output (no deps).
Typecheck: npx tsc --noEmit 2>&1 | grep eval/ — errors about the missing src/server/search/run.ts module are expected until it lands; everything else in eval/ must be clean.
eval/README.md: how to run, what each metric means, how to add a case (5-10 lines each section max).
`

const CONTEXT_FOR_CRITICS = `
Context: a hiring test for WeRoad (small-group travel). Read ${ROOT}/REQUIREMENTS.md and ${ROOT}/AGENTS.md (the plan and architecture), ${ROOT}/src/shared/types.ts (contract) and skim ${ROOT}/samples/trips.json + faqs.json.
The candidate's own extra scope (from their brief to us): TypeScript; Elasticsearch + Kibana via Docker; WeRoad look & feel; API-driven frontend and /admin backoffice without auth; every search stored with arguments/output; each search has a confidence score and the results must be honest about confidence; visitor feedback on results to improve the algorithm later; a collapsed list of example searches to simulate; admin CRUD for FAQs and trips, search logs with filters; FAQs related to trips; filter by any trip attribute (e.g. isWomenOnly); lightweight RAG for FAQs; LLM (Claude) turning natural language into query parameters; deploy to Railway last.
Evaluators score: AI-assisted development workflow, AI stack (model choice, prompt/tool design, measuring quality/cost/latency), product (does it solve the user problem, what was left out and why), ownership (scope, trade-offs, what to ship first, how to measure impact), engineering (structure, readability, tests where they matter).
Data facts already found: 15 trips have continent=null (we backfill); isWomenOnly is false on all 500 departures; 155 departures NOT_AVAILABLE (mostly near dates), 10 SOLD_OUT, 4 WAITING_LIST; some departures are in the past (we shift dates forward at seed); 'party' never appears in text but moods.party exists; no images in the data.
Already decided/planned: rule-based fallback parser; eval harness with ~30 cases; search log with latency/tokens/cost; per-result and per-search feedback; Kibana data view; date shift; continent backfill; synonyms; semantic embeddings; relaxation to closest options with reasons.
Give us what is NOT already covered, or covered badly. Be concrete and specific to this data and this product; no generic advice. For each item: title, why it matters (1-2 sentences, tie to the brief or evaluation points), suggested approach (1-2 sentences), priority: 'now' (should be in the demo) / 'next' (mention as next step) / 'later', effort: S/M/L. Max 10 items, ranked.`

const FINDINGS = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          approach: { type: 'string' },
          priority: { type: 'string', enum: ['now', 'next', 'later'] },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
        },
        required: ['title', 'why', 'approach', 'priority', 'effort'],
      },
    },
  },
  required: ['items'],
}

const LENSES = [
  { key: 'product', prompt: 'You are a senior product manager for a travel marketplace search. Lens: user problem (users who do not know what they want; text searches returning nothing although trips exist), conversion, trust/honesty, UX of a search-page assistant, business metrics and how to measure impact (A/B, funnel), what to ship first.' },
  { key: 'ai', prompt: 'You are a senior applied-AI engineer. Lens: LLM prompt and tool/schema design for NL→filters over multiple turns, grounding and hallucination risks, FAQ RAG, confidence calibration (is the planned confidence honest and meaningful?), eval design, model choice, cost and latency, prompt caching, failure modes and fallbacks, feedback loop into improvements, prompt injection via user messages.' },
  { key: 'eng', prompt: 'You are a staff engineer reviewing a demo that will be deployed on Railway. Lens: Elasticsearch modelling and operations (memory on Railway, Kibana exposure without auth, security disabled, index aliases/reindex), data integrity under admin CRUD, open admin on a public URL (vandalism), PII in logs, rate limiting/LLM cost abuse, timezones/date math, testing strategy, Docker image size (onnx model), observability, reproducibility.' },
]

phase('Build')
const builds = parallel([
  () => agent(SEARCH_UI, { label: 'build:search-ui', phase: 'Build' }),
  () => agent(ADMIN_UI, { label: 'build:admin-ui', phase: 'Build' }),
  () => agent(EVAL, { label: 'build:eval', phase: 'Build' }),
])

phase('Critique')
const critiques = parallel(LENSES.map((l) => () =>
  agent(`${l.prompt}\n${CONTEXT_FOR_CRITICS}`, { label: `critique:${l.key}`, phase: 'Critique', schema: FINDINGS })
    .then((r) => r && { lens: l.key, items: r.items })))

const [b, c] = await Promise.all([builds, critiques])
return { builds: b, critiques: c.filter(Boolean) }
