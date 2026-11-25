# How this was built with AI agents

Tooling: Claude Code (desktop) with Claude Opus 5.5 as the main agent, its Workflow tool for parallel subagents, and the in-app browser for design research and UI checks. Everything the agents needed to know lives in [`AGENTS.md`](../AGENTS.md); `CLAUDE.md` just imports it, so any agent (Claude Code, Codex, Cursor…) gets the same context.

## The loop

1. **Understand before building.** Read the brief, then profiled the data with scripts instead of eyeballing it. That surfaced what drove the design: 15 trips without a continent ("trips in Asia" would miss Vietnam and Bali), no women-only departure at all, `NOT_AVAILABLE` clustered on near dates (booking closed), past departures, "party" present only as a mood score, no images.
2. **Copy the design system, don't imitate it.** Extracted WeRoad's CSS variables (colours, radii, font) from weroad.com in the browser. Also noticed weroad.com already has an AI chat — on a separate page. That made the product decision: ours lives *on* the search page and shares state with the filters.
3. **Spike the risky parts first.** Before writing the pipeline: compared two local embedding models on our own trip texts (MiniLM separated relevant/unrelated better than bge), and proved that one Elasticsearch query can return BM25 and kNN scores per hit next to a nested "bookable departure" filter.
4. **Contract first, then parallel agents.** Wrote `src/shared/types.ts`, the API section of `AGENTS.md` and the SPA shell, then ran a workflow ([`docs/ai-workflow/parallel-build.workflow.js`](ai-workflow/parallel-build.workflow.js), prompts included) with strict file ownership: search UI, backoffice, eval set, plus three critics (product, AI, engineering) looking for blind spots. I wrote the search core myself meanwhile: it is where judgement matters.
5. **Measure, then change.** Every search-behaviour change went through the eval (`npm run eval -- --rules` is free and deterministic). Examples of bugs found by measuring, not by reading: "Mentions 'sushi and temples'" claimed for trips that only mention temples (fixed with per-word coverage); a vague leftover word ("warm") turning every match into a "closest option"; a budget silently making "northern lights" irrelevant. Score thresholds were set from measured distributions, not guessed.
6. **Test the LLM integration for real.** Probing the live API showed the first structured-output schema (24 optional fields) timing out at 90 s and the nullable version rejected (max 16 union parameters). The fix — every field required, "empty means unset" — is now written into the `add-search-filter` skill so the next agent doesn't repeat it.
7. **Review adversarially.** A second workflow ([`docs/ai-workflow/review.workflow.js`](ai-workflow/review.workflow.js)) ran five independent reviewers (pipeline correctness, requirements against the live API, frontend, security/ops, simplicity), each followed by a skeptic instructed to refute every finding. Only findings with evidence were fixed.

## How agent output is checked

- `npm run typecheck` (TypeScript 7) and `npm test` (business rules: bookability, penalties, confidence, parser, redaction).
- The eval's hard gates: 0 sold-out leaks, 0 dead ends, 0 errors — on every run, rules and LLM.
- The UI checked in the browser after each integration (example playback, chips, admin).
- I read every line of `src/server/search/`; for UI code I read the diffs and checked behaviour rather than every line.

## Reusable agent assets

| File | Use |
|---|---|
| `AGENTS.md` | Architecture, non-negotiables, API, design tokens, conventions, commands |
| `.claude/skills/add-search-filter` | Playbook to add a new search dimension end to end (8 places, in order) |
| `.claude/skills/run-eval` | Run the eval, compare with the last saved run, explain regressions |
| `.claude/agents/search-reviewer.md` | Pre-commit reviewer for the non-negotiables |
| `docs/ai-workflow/*.workflow.js` | The two multi-agent workflows, with every subagent prompt |
