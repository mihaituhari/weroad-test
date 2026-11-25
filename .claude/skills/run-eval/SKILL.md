---
name: run-eval
description: Run the offline search eval (quality, latency, cost), compare it with the previous saved run and explain regressions. Use after any change to src/server/search, the prompt, synonyms, embeddings or confidence constants, when comparing Claude models, or when the user asks how good / fast / expensive the assistant is.
---

# Run and read the eval

The eval (`eval/run.ts`, cases in `eval/cases.ts`) replays scripted conversations through the real pipeline against the local Elasticsearch, so ES must be up and seeded (`npm run es:up`, then `npm run seed` if empty).

## Run

- Rule-based parser only, free and deterministic: `npm run eval -- --rules`
- With the LLM (costs money: measured $0.18 per full run on Sonnet 5.5 (default), $0.35 on Opus 5.5, $0.01 on Haiku 5.5): `npm run eval -- --model <id> --save`
- One area: `--only <case id or tag>` (tags: dates, budget, faq, honesty, multi-turn, semantic, ...)

Ask the user before running LLM evals in a loop (several models or repeats): it spends their API budget.

## Compare

`--save` writes `eval/results/<date>-<model|rules>.json`. Compare the new file with the latest older one for the same model:
- **Hard gates** (any regression is a bug): sold-out leaks = 0, dead ends = 0, errors = 0.
- **Quality**: case pass rate, check pass rate by tag, state-field accuracy, top-3 hit rate. A drop of one case can be LLM variance: rerun that case with `--only` before concluding.
- **Honesty**: the `honesty` and `unknown` tags; confidence must stay low on impossible requests.
- **Cost / latency**: p50/p95 per assistant turn and $ per turn. The search part (ES + matching) should stay well under 100 ms; the LLM dominates.

## Explain

Report a short table (before → after) and, for each failed check, the case id, the expectation and what came back. Point to the code that decides it (`interpret.ts` prompt for parsing, `match.ts` for penalties, `confidence.ts` constants for calibration). Don't tune constants to pass one case without checking the others.
