# Offline eval

How we measure the assistant's quality, cost and latency: 33 scripted visitor conversations (`cases.ts`) played through the real pipeline (`runSearch`) against the local catalog, without writing to the search log.

## Run

```
npm run es:up                      # Elasticsearch must be up; the catalog is seeded if empty
npm run eval                       # LLM interpreter if ANTHROPIC_API_KEY is set, rules otherwise
npm run eval -- --rules            # force the rule-based parser (free, deterministic baseline)
npm run eval -- --model claude-haiku-5-5 --save   # compare models; writes eval/results/<date>-<model>.json
npm run eval -- --only faq         # one case id or one tag
```

Exit code is 1 on any sold-out leak, dead end or crash, so it can gate CI. Quality is read from the report: compare with the last file in `eval/results/`.

## Metrics

- **Cases passed / checks passed by tag**: every expectation of a case is its own check, so a near miss shows what broke.
- **State-field accuracy**: did the interpreter turn the words into the right filters (`state.*` checks).
- **Top-3 hit rate**: an expected trip is in the first 3 results (`topAnyOf`).
- **Sold-out leaks / dead ends**: checked on every turn, not just the last. Both must be 0 (brief's non-negotiables).
- **LLM fallbacks**: assistant turns the rule parser had to handle (timeout, invalid output, API error).
- **Latency p50/p95**: per assistant turn (and the LLM share of it) and per classic search, from the search log timings.
- **Cost**: total and per assistant turn, from the token usage and the pricing table in `src/server/config.ts`.
- Table column `exact` is exact matches / results shown (exact can exceed shown, the list is capped).

## Add a case

Append to `CASES` in `cases.ts`: an `id`, `tags`, an optional `start` (the classic search), the `turns` typed by the visitor, and `expect`.
Expectation semantics are documented on the `Expect` interface. Pick trip ids by grepping `samples/trips.json`.
Departure dates are shifted at seed time, so for date cases assert the parsed state with `nextDay()` / `nextMonth()`, never trip ids.
A failing case that the product should handle is a good case: keep it and fix the pipeline, don't loosen the expectation.
