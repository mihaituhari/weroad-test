# Decisions

## The problem, as I read it

Two problems are in the brief: visitors **who don't know what they want yet**, and **text searches that return nothing although matching trips exist**. The brief asks for an assistant that *lives on the search page* and starts from the current search. weroad.com already has an AI chat, but on a separate page (`/ai-chat`). So the core design choice is: **the search state is the conversation state.** The classic bar, the filter pills, the chips and the assistant all edit one `SearchState`, and every change is a normal search the visitor can see and undo.

## What I'd ship first

1. **Better retrieval behind the existing search bar, with no LLM.** Synonyms, typo tolerance and semantic search (embeddings) fix "returns nothing although trips exist" for every visitor. It costs ~10 ms and no tokens, and is measured by the zero-result rate.
2. **No dead ends.** When nothing matches every constraint, show the closest trips and say exactly what differs ("3 days outside your dates", "22% over budget").
3. **The conversational assistant** for refinements, behind an A/B test (see Measuring impact).
4. FAQ answers in the same panel.

The demo has all four. Steps 1–2 are deterministic and unit-tested; the LLM only translates language into the state.

## What I left out, and why

- **Booking, auth, real integrations** (out of the brief). The backoffice is open, by request: see *Risks*.
- **Clarifying questions written by the LLM.** Instead, broad searches get deterministic "narrow it down" chips computed from the results (region, month, vibe, length, budget, with counts). Cheaper, instant, and never wrong about what exists.
- **Streaming replies, server-side conversation memory.** The API is stateless: the client sends the state and the last 6 turns. Simpler to scale and test; the trade-off is that a client could forge history (it can only affect its own search).
- **Learning-to-rank from feedback.** Collected first (votes, clicks, per-result votes, versioned logs); there is not enough data to learn from yet.
- **Multilingual** (Italy and Spain are WeRoad's core markets). The LLM already normalises any language to English; the embeddings and rules parser are English-only. Next step: `multilingual-e5-small` (same 384 dims) and IT/ES eval cases.
- **Photos.** Not in the data; cards use a gradient per continent.

## Architecture

One Node 24 service (Hono API + React SPA built by Vite) and Elasticsearch 9.5, plus Kibana. TypeScript everywhere, with one shared contract (`src/shared/types.ts`). Node runs the server's `.ts` directly, so there is no server build step.

**Why Elasticsearch, and as the only store.** This is a search problem: BM25 with travel synonyms and fuzziness, nested departures filtered by bookability, dates, price and seats, and kNN on embeddings, all in one query. `include_named_queries_score` returns the lexical and semantic scores of each hit separately, which is what makes the confidence explainable. The search log is analytics data (written once per search, then updated with clicks and feedback), so it lives in the same cluster and Kibana works on it immediately. I considered Postgres + pgvector, which is better for transactional CRUD, but nothing here needs transactions, and it would mean a second store plus a hand-built analytics UI. In production the catalog's source of truth stays WeRoad's backend; ES would be a projection of it.

**Local embeddings** (`all-MiniLM-L6-v2`, 384 dims, ~1 ms per query, baked into the image): no second API key, no network at query time. On our own trip texts, MiniLM separated related and unrelated trips better than `bge-small`.

**Pipeline per turn** (`src/server/search/`):

```
message → FAQ retrieval (hybrid ES) → Claude: new SearchState + reply + unmatched + FAQ answer
        → normalise against catalog vocabulary (unknown values → "unmatched")
        → ES: strict query (all constraints) ∥ relaxed query (bookable only)
        → match.ts: penalties per constraint, best departure, ✓/✗ reasons
        → confidence.ts → response + search log
```

## AI stack

- **One LLM call per turn, and only for language.** Claude returns the complete new state (not a diff, which is easier to reason about), a one-line reply, the requirements it couldn't map, and an FAQ answer grounded only in the 3 retrieved articles (cited ids are checked). It never ranks, filters, scores confidence or describes results. Those parts are deterministic, testable and free.
- **Structured outputs + zod**, then the same validation as any client input. Unknown destinations become `unmatched` instead of impossible filters.
- **A schema lesson learned on the live API:** 24 optional fields made the output grammar compile for 90 s+, and making them nullable hits the API's limit of 16 union parameters. Every field is now required, with an empty value meaning "unset". This is written into the `add-search-filter` skill.
- **Fallbacks:** without a key, on a 10 s timeout, a refusal, invalid output or a reached daily budget, a rule-based parser takes over. The UI says so and the understanding score drops.
- **Prompt injection:** the visitor's message, history and FAQ bodies are passed as data, the output is schema-bound, and only state changes can result. Emails and phone numbers are redacted before the LLM and the log.
- **Model choice:** measured, not assumed (table below).

**Model comparison** (`npm run eval`, 33 cases / 37 assistant turns, effort `low`, 25 Nov 2026):

| | Opus 5.5 | **Sonnet 5.5 (default)** | Haiku 5.5 | Rules only |
|---|---|---|---|---|
| Cases passed | 32/33 | **32/33** | 30/33 | 31/33 |
| State-field accuracy | 100% | **100%** | 96% | 100%* |
| Expected trip in top 3 | 95% | **95%** | 90% | 100%* |
| Sold-out leaks / dead ends / fallbacks | 0 / 0 / 0 | **0 / 0 / 0** | 0 / 0 / 0 | 0 / 0 / – |
| Latency per turn p50 / p95 | 3.1 / 4.1 s | **2.5 / 3.6 s** | 2.2 / 3.5 s | 0.02 / 0.1 s |
| Cost per turn (≈ per 1k turns) | $0.0094 ($9.4) | **$0.0049 ($4.9)** | $0.0003 ($0.3) | $0 |

\* The rules parser is tuned on these very phrasings, and it can't flag requests we don't sell ("Antarctica", "my dog"), which is its two failures. The LLM's value is in the long tail of wording that the eval only samples.

**Sonnet 5.5:** Opus quality at half the price and faster. Haiku is the next lever if cost dominates. Its misses were reading "at least two weeks" as 12 days, losing the destination when one message mixed a question and a search, and an aurora question. Prompt work could close these gaps, so it's worth re-running the comparison after any prompt change. Latency is dominated by the LLM (search is ~20 ms). Next levers are prompt caching once the prefix is long enough (the system prompt is built to be cache-stable) and skipping the LLM when the rules parser consumes the whole message.

## Confidence, and why it's honest

**Per trip** = constraint match × relevance.

- *Constraint match* is Π(1 − penalty) over the constraints the visitor set. Penalties grow with distance: 3 days late beats 3 weeks late, and 10% over budget beats 50%. Age band is a soft preference, because the FAQ says it's a guide, not a rule.
- *Relevance* combines lexical evidence (BM25 scaled by the share of the visitor's words the trip actually mentions) and semantic similarity (calibrated on measured cosine distributions: unrelated trips sit at ~0.1–0.2, related ones at 0.35–0.5), plus mood scores for vibes.
- Free text decides what counts as a match only when the catalog clearly has that topic ("northern lights"). Vague words ("something warm") only nudge the ranking.

**Per search** = understanding × quality of the top results. Understanding is 1 for a classic search, lower for the rules fallback, and lower again for each unmapped requirement. The banner always says why ("No trip matches everything…", "We can't search for: Antarctica").

**Every ✓/✗ is evidence**: "Mentions 'temples'" only if it does, and "Close to 'sushi and temples' (mentions temples)" otherwise.

**Honesty is checked online too:** `/admin` shows CTR and 👍-rate per confidence level. If "high" doesn't outperform "low", the formula is wrong.

## Measuring quality, cost and latency

- **Offline:** `eval/` replays 33 scripted conversations (tags: dates, budget, faq, honesty, multi-turn, semantic…) through the real pipeline. It scores state-field accuracy, top-3 hit rate and honesty (confidence capped on impossible requests), with hard gates: **0 sold-out leaks, 0 dead ends**. It records latency and cost per turn. Results are saved per model in `eval/results/`.
- **Online:** every search is logged with its state in and out, results, confidence, latency (LLM vs search), tokens, cost, error and version (commit + prompt version), plus votes, per-trip votes and clicks. `/admin` shows zero-exact rate, CTR, zero-exact *rescue* rate (opened a closest option), p50/p95 latency, cost, the top unmatched requests and the zero-result queries (the backlog for synonyms, prompt and catalog). Kibana has the raw data.

## Measuring impact

A/B test by session: classic search vs classic + assistant.

- **Primary metric:** sessions that open a trip page (then booking starts, once available).
- **Secondary metrics:** zero-result rate, rescue rate, turns to first click.
- **Guardrails:** p95 latency, LLM cost per session, 👎 rate.

<!-- Sizing: +2pp on a 30% baseline needs ~8-9k sessions per arm. -->

## Data fixes (explicit, in `seed.ts`; samples untouched)

- Backfilled 15 missing continents.
- Shifted all departures by (today − export date) so the demo stays in the future; the shift is re-applied after a week on long-running deploys.
- Bookable = `PLANNED | ALMOST_CONFIRMED | CONFIRMED | ALMOST_FULL` with seats left and a future start. `NOT_AVAILABLE` (bookings closed, mostly near dates), `WAITING_LIST` and `SOLD_OUT` are never shown. This is enforced in the ES query *and* re-checked in code.
- No departure is women-only: such requests say so instead of returning nothing.
- Each trip lists only its next 10 departures, so a window after the last one is labelled "dates not published yet", not "no trips".

## Risks and next steps

**Risks I accepted for a demo, and what production needs:**
- **The backoffice has no auth** (by request). On a public URL anyone could edit or reset the catalog. For deploys: an optional admin token on write routes, plus a scheduled catalog restore.
- **Elasticsearch and Kibana run without security.** Locally they're bound to 127.0.0.1. On Railway, ES must stay on the private network, and Kibana needs either security (`ELASTIC_PASSWORD` + `kibana_system`) or no public domain. `/admin` covers the stats either way.
- **LLM abuse.** Assistant turns are rate-limited per visitor (20 per 5 minutes). A daily spend cap, counted in-process and including timeouts, falls back to the rules parser. Request bodies and fields have size limits.
- **Privacy.** Emails and phone numbers are redacted in messages, history, state text and feedback comments before the LLM and the log. Next: a retention policy on the log (e.g. 30 days).
- **Stateless conversation.** A client can forge its own history; it only affects its own search.
- **Synonyms are baked into the index settings**, so changing them needs a reindex (`npm run seed`). Next: the ES synonyms API and an "add synonym" action next to zero-result queries in `/admin`.

**Next steps, in order:**
1. A/B test with click tracking (already logged), then booking starts.
2. Calibrate the confidence thresholds on real outcomes (the CTR and 👍-rate per confidence level in `/admin`).
3. Turn down-voted searches into eval cases from `/admin`.
4. Multilingual embeddings and eval cases.
5. A cheaper model path: prompt caching once the prefix is long enough, skipping the LLM when the rules parser fully consumes the message, and Haiku once the eval shows it holds quality.
6. Departure-level FAQs on cards (deposit, "open to book", flights not included) instead of a destination's currency or plugs.
