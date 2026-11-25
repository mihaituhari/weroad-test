---
name: add-search-filter
description: Add a new search dimension (a trip or departure attribute the visitor can ask for, e.g. "private room", "flights from Milan", "max group size") end to end - contract, LLM schema and prompt, rule parser, Elasticsearch filter, matching/penalty, UI chip, tests and eval case. Use whenever the user asks to make the search understand or filter on something new.
---

# Add a search filter

A filter touches eight places. Do them in this order, so each step typechecks against the previous one.
Read `AGENTS.md` first (non-negotiables, pipeline). Existing filters to copy from: `privateRoom` (departure flag), `physical` (trip enum with distance), `budgetMax` (number with distance).

1. **Contract** – add the field to `SearchState` in `src/shared/types.ts`, with a one-line comment on its meaning and unit.
2. **Validation** – add it to `SearchStateSchema` in `src/server/search/state.ts`. If it uses catalog vocabulary, map it in `normalizeState` (unknown values go to `unmatched`, never to the filter).
3. **LLM** – in `src/server/search/interpret.ts`:
   - add it to `LlmState` as a *required* field whose empty value means unset (`""`, `0`, `false`, `[]`). Never `.optional()` / `.nullable()`: the structured-output grammar caps unions at 16 and optionals blow up compile time;
   - describe it in the `# Fields` section of the system prompt (when to set it, examples);
   - bump `PROMPT_VERSION`.
4. **Rules fallback** – add a regex in `src/server/search/rules.ts` only if there is a common phrasing; add the trigger words to `STOPWORDS` so they don't leak into `text`.
5. **Retrieval** – hard constraint: add the ES filter in `retrieve.ts` (`tripFilters` for trip fields, `departureFilters` for `tours.*`). Soft preference: no ES filter.
6. **Matching** – add a check in `match.ts` (`tripChecks` or `departureChecks`): penalty 0 when satisfied, growing with distance, capped below 1; an ✓ and a ✗ reason in plain words; `soft: true` for preferences. Add a `RELAX_NOTES` entry for hard constraints so "closest options" explain it. Add the label in `FIELD_LABELS` (`run.ts`).
7. **UI** – add the chip text in `chips()` (`src/web/search/format.ts`) and, if visitors should set it by hand, a control in `Filters.tsx`. If it's a new ES field, add it to the mapping in `es.ts` (additive changes are applied on boot) and to `TripSchema`/`TourSchema` in `catalog.ts` + the admin editor.
8. **Prove it** –
   - unit test in `match.test.ts` (penalty and reason) and, if you added a pattern, `rules.test.ts`;
   - eval case(s) in `eval/cases.ts` with a tag, including an honesty case if the catalog can't satisfy it;
   - run `npm run typecheck && npm test && npm run eval -- --only <tag>`; then the full `npm run eval -- --save` and compare with the previous file in `eval/results/` (see the `run-eval` skill).

Done when: the field round-trips through the assistant ("only X" sets it, "forget X" clears it), the chip shows and removes it, a non-matching trip shows a ✗ reason instead of disappearing silently, and eval shows no regression.
