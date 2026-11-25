# How the search works

One endpoint, `POST /api/search`, serves both the classic search bar and the assistant. The page sends its **current search state** (text, dates, filters). It also sends the visitor's **message** when the assistant is used, plus the last few chat turns. The answer is the new state, the results, a confidence score and the reasons behind it. Code: `src/server/search/`, one file per step below.

## One turn, end to end

```mermaid
flowchart TD
    REQ["POST /api/search<br/>state + optional message + history"] --> VAL["Validate and clean<br/>zod schema, size caps, real dates<br/>redact emails and phones"]
    VAL --> NORM1["Normalise against the catalog<br/>unknown values go to 'unmatched'"]
    NORM1 --> Q{"Message?"}

    Q -- "no: classic search" --> EMB
    Q -- "yes: assistant turn" --> FAQ["Retrieve FAQ candidates<br/>hybrid ES query, only general articles<br/>and the destinations being discussed"]
    FAQ --> LLM{"Claude available?<br/>key, budget, 10 s timeout"}
    LLM -- "yes" --> CLAUDE["Claude Sonnet 5.5, one structured call<br/>new state + reply + unmatched<br/>+ FAQ answer citing retrieved ids"]
    LLM -- "no / error / refusal" --> RULES["Rule-based parser<br/>dates, budget, group size, places, vibes"]
    CLAUDE --> NORM2["Validate field by field, normalise again"]
    RULES --> NORM2
    NORM2 --> EMB

    EMB["Embed the free text<br/>local MiniLM, about 1 ms"] --> ES["Elasticsearch: two queries in parallel<br/>strict = every constraint as a filter<br/>relaxed = bookable departure only"]
    ES --> SCORES["Scores per trip<br/>BM25 with synonyms and typos, word coverage,<br/>kNN similarity, must-have phrases"]
    SCORES --> MATCH["Match each trip<br/>bookable departures only<br/>penalty per constraint, by distance<br/>best departure + reasons"]
    MATCH --> CONF["Relevance and confidence<br/>per trip and per search"]
    CONF --> PICK["Pick what to show<br/>exact matches, else closest options"]
    PICK --> RESP["Response<br/>results, reasons, confidence, loosened filters,<br/>unmatched, FAQ answer, narrow-down chips"]
    PICK --> LOG[("Search log in ES<br/>only searches with criteria<br/>later: clicks and feedback")]
```

## The steps

1. **Validate and clean** (`state.ts`). Every input is checked: field sizes, real calendar dates (2027-02-29 is rejected), and known values only. Emails and phone numbers are masked in the message, chat history and free text before anything reaches Claude or the log. Values the catalog doesn't know (e.g. "Antarctica") are listed as **unmatched**, never silently dropped.
2. **Understand the message** (`interpret.ts`, assistant turns only).
   - **What Claude returns:** a single Claude call turns the message into the complete new search state, a one-line reply and the requests it can't map. It also answers FAQ questions, using only the help-centre articles retrieved for that message, and the cited ids are checked.
   - **What Claude doesn't do:** rank, filter or score.
   - **Fallback:** if Claude is unavailable (no key, timeout, refusal, invalid output, daily spend cap), the rule-based parser (`rules.ts`) answers instead, and confidence is lowered.
3. **Retrieve** (`retrieve.ts`). Two Elasticsearch queries run at the same time:
   - *strict*: every constraint is a filter, so exact matches are never missed;
   - *relaxed*: only "has a bookable departure", the pool for the closest options.

   Each query scores the free text in three ways:
   - BM25 with travel synonyms and typo tolerance;
   - which of the visitor's words the trip really mentions, with no fuzziness, so "skiing" doesn't count "sky";
   - embedding similarity.

   A must-have ("cooking class") has to appear as a phrase.
4. **Match** (`match.ts`, pure functions).
   - **Bookability:** only bookable departures count (open status, seats left, future date). Sold-out departures are never shown. This is enforced in the query and checked again here.
   - **Penalties:** each constraint gets a penalty that grows with distance. Three days late is closer than three weeks; 10% over budget is closer than 50%.
   - **Exact match:** a trip with zero penalty on every hard constraint. The age band is only a preference, as the FAQ says it's a guide.
   - **Reasons:** every check produces a ✓ or ✗ reason in plain words.
5. **Score** (`confidence.ts`). See below.
6. **Respond and log** (`run.ts`). Besides the results, the response carries:
   - the filters that were loosened ("budget — up to 22% over");
   - the unmatched requests;
   - one "good to know" FAQ per destination;
   - "narrow it down" chips for broad searches (`suggest.ts`).

   Searches with criteria are logged with their state, results, confidence, latency, tokens, cost and version. Clicks and votes are added to the same log entry later.

## Which trips are shown, and how sure we are

```mermaid
flowchart TD
    T["Each trip with a bookable departure"] --> P["Constraint match<br/>= product of 1 - penalty, each capped at 0.9"]
    T --> R["Relevance, only if there is free text or a vibe<br/>lexical coverage, semantic similarity, mood scores"]
    P --> X{"Every hard constraint met?"}
    R --> D{"Does the text decide?<br/>yes if it is the whole search,<br/>or some trip matches it strongly, 0.8+"}
    D -- "yes" --> XR{"Relevance 0.5+?"}
    D -- "no, vague words like 'warm'" --> X
    XR -- "yes" --> X
    XR -- "no" --> CL["Closest option"]
    X -- "yes" --> EX["Exact match"]
    X -- "no" --> CL

    EX --> N{"3 or more exact matches?"}
    CL --> N
    N -- "yes" --> S1["Show up to 12 exact matches"]
    N -- "no" --> S2["Show the exact ones, then the closest options<br/>up to 6 in total, picked by closeness"]
    S1 --> SORT["Visitor's sort (price or date) orders what is shown"]
    S2 --> SORT

    SORT --> SC["Search confidence<br/>= understanding x quality of the top results"]
    SC --> LV{"Level"}
    LV --> H["high: 0.75+"]
    LV --> M["medium: 0.5 to 0.75"]
    LV --> L["low: below 0.5"]
```

- **Trip confidence** = constraint match × relevance factor. The relevance factor counts fully when the text decides the search, and lightly when it is only a nudge. A *closest option* is capped at 0.7, so its badge never reads "high".
- **Understanding** = 1 for a classic search, lower for the rules fallback or when Claude reports ambiguity, and ×0.8 per unmatched request.
- **Search confidence** looks at the top exact matches when there are any, otherwise at the top closest options. With no exact match, it can't be "high". If *everything* asked was unservable (e.g. only "Antarctica"), it is low and the banner says so.
- **No criteria at all** (the landing page, "Start over"): nothing is scored, no "% match" is shown, and the search isn't logged.

## Before any search: data preparation

On first boot `seed.ts` loads `samples/`, backfills the 15 missing continents, and shifts every departure forward by the days elapsed since the export, so the demo stays in the future. On later boots, departures are moved forward in place, which keeps backoffice edits.

## Where to look

| Question | File |
|---|---|
| What can be searched, and how is input validated? | `src/shared/types.ts`, `search/state.ts` |
| What does Claude see and return? | `search/interpret.ts` (prompt and schema) |
| What does the fallback understand? | `search/rules.ts` |
| Which Elasticsearch queries run? | `search/retrieve.ts`, `es.ts` (mappings, synonyms) |
| Why is a trip ✓ or ✗, exact or closest? | `search/match.ts` |
| How are relevance and confidence computed? | `search/confidence.ts` |
| How do we know it works? | `eval/` (`npm run eval`), `*.test.ts` |
