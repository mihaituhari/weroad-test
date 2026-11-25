// Offline eval of the search assistant: quality (expectations per case), safety (no sold-out leaks, no dead ends),
// latency and cost. Usage: npm run eval -- [--rules] [--model <id>] [--only <case id or tag>] [--save]
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config, today } from '../src/server/config.ts';
import { waitForEs } from '../src/server/es.ts';
import { runSearch } from '../src/server/search/run.ts';
import { seed } from '../src/server/seed.ts';
import { BOOKABLE_STATUSES, type ChatTurn, type SearchLog, type SearchResponse, type SearchState } from '../src/shared/types.ts';
import { CASES, type EvalCase, type Expect } from './cases.ts';

const { values: args } = parseArgs({
  options: { rules: { type: 'boolean', default: false }, model: { type: 'string' }, only: { type: 'string' }, save: { type: 'boolean', default: false } },
});
// Without a key the pipeline silently falls back to rules: label the run for what it really measured.
const label = args.rules || !config.anthropicKey ? 'rules' : (args.model ?? config.model);

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
interface Turn {
  message: string | null;
  response: SearchResponse;
  log: SearchLog;
}
interface CaseResult {
  c: EvalCase;
  turns: Turn[];
  checks: Check[];
  leaks: string[];
  deadEnds: number;
}

/** Plays a case like the UI: classic search for `start`, then each message with the previous state and history. */
async function play(c: EvalCase): Promise<Turn[]> {
  const opts = { log: false, forceRules: args.rules, model: args.model };
  const steps = [...(c.start ? [null] : []), ...c.turns];
  const history: ChatTurn[] = [];
  const turns: Turn[] = [];
  let state: SearchState = c.start ?? {};
  for (const message of steps) {
    const req = { sessionId: `eval-${c.id}`, state, history: [...history], ...(message && { message }) };
    const { response, log } = await runSearch(req, opts);
    turns.push({ message, response, log });
    state = response.state;
    if (message) history.push({ role: 'user', text: message });
    if (message && response.reply) history.push({ role: 'assistant', text: response.reply });
  }
  return turns;
}

/** State expectation semantics are documented on `Expect` in cases.ts. */
function matches(want: unknown, got: unknown): boolean {
  if (typeof want === 'boolean') return Boolean(got) === want; // normalizeState drops false values
  if (got == null) return false;
  const lc = (v: unknown) => String(v).toLowerCase();
  if (Array.isArray(want)) return Array.isArray(got) && want.every((w) => got.some((g) => lc(g).includes(lc(w))));
  if (typeof want === 'number') return typeof got === 'number' && Math.abs(got - want) <= Math.abs(want) * 0.1;
  if (typeof want === 'string') return lc(got).includes(lc(want));
  return Object.keys(want as object).every((k) => ((got as Record<string, number>)[k] ?? 0) >= 0.5);
}

function score(e: Expect, r: SearchResponse): Check[] {
  const ids = r.results.map((x) => x.trip.id);
  const top3 = ids.slice(0, 3);
  const faqIds = r.answer?.faqs.map((f) => f.id) ?? [];
  const checks: Check[] = Object.entries(e.state ?? {}).map(([k, want]) => {
    const got = r.state[k as keyof SearchState];
    return { name: `state.${k}`, pass: matches(want, got), detail: `got ${JSON.stringify(got)}` };
  });
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  if (e.topAnyOf) add('top3', top3.some((id) => e.topAnyOf!.includes(id)), `top3 ${top3}`);
  if (e.noneOf) add('noneOf', !ids.some((id) => e.noneOf!.includes(id)), `found ${ids.filter((id) => e.noneOf!.includes(id))}`);
  if (e.minExact != null) add('minExact', r.exactCount >= e.minExact, `exact ${r.exactCount}`);
  if (e.zeroExact) add('zeroExact', r.exactCount === 0 && r.results.length > 0, `exact ${r.exactCount}/${r.results.length}`);
  if (e.maxConfidence != null) add('maxConfidence', r.confidence.score <= e.maxConfidence, `conf ${r.confidence.score.toFixed(2)}`);
  if (e.minConfidence != null) add('minConfidence', r.confidence.score >= e.minConfidence, `conf ${r.confidence.score.toFixed(2)}`);
  if (e.answerFaqAnyOf) add('faq', faqIds.some((id) => e.answerFaqAnyOf!.includes(id)), `faqs ${faqIds}`);
  if (e.unmatched) add('unmatched', r.unmatched.length > 0, `unmatched ${JSON.stringify(r.unmatched)}`);
  return checks;
}

async function evaluate(c: EvalCase): Promise<CaseResult> {
  try {
    const turns = await play(c);
    // Hard rules from the brief, checked on every turn, not just the last one.
    const leaks = turns.flatMap((t) =>
      t.response.results.flatMap((r) =>
        r.departures.filter((d) => !BOOKABLE_STATUSES.includes(d.salesStatus) || d.seatsLeft <= 0 || d.startingDate <= today()).map((d) => d.id),
      ),
    );
    const deadEnds = turns.filter((t) => t.response.results.length === 0).length;
    const checks = [
      ...score(c.expect, turns.at(-1)!.response),
      { name: 'no-sold-out', pass: !leaks.length, detail: `leaked ${leaks}` },
      { name: 'no-dead-end', pass: !deadEnds, detail: `${deadEnds} empty turn(s)` },
    ];
    return { c, turns, checks, leaks, deadEnds };
  } catch (err) {
    return { c, turns: [], checks: [{ name: 'error', pass: false, detail: String(err) }], leaks: [], deadEnds: 0 };
  }
}

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * xs.length) - 1)] : 0);
const rate = (checks: Check[]) => {
  const ok = checks.filter((x) => x.pass).length;
  return `${ok}/${checks.length} (${checks.length ? Math.round((100 * ok) / checks.length) : 0}%)`;
};
const usd = (n: number) => `$${n.toFixed(4)}`;
const row = (cells: (string | number)[], widths = [30, 5, 5, 7, 6, 7, 8]) => cells.map((v, i) => String(v).padEnd(widths[i] ?? 0)).join(' ');

const cases = CASES.filter((c) => !args.only || c.id === args.only || c.tags.includes(args.only));
if (!cases.length) throw new Error(`No case or tag matches "${args.only}"`);
if (!args.rules && !config.anthropicKey) console.warn('ANTHROPIC_API_KEY not set: the assistant falls back to the rule-based parser.\n');

await waitForEs(5);
await seed(); // no-op unless the catalog is empty
console.log(`Eval: ${cases.length} cases, interpreter ${label}, today ${today()}\n`);
console.log(row(['case', 'ok', 'conf', 'exact', 'interp', 'ms', '$', 'failed checks']));

const results: CaseResult[] = [];
for (const c of cases) {
  const r = await evaluate(c);
  results.push(r);
  const last = r.turns.at(-1)?.response;
  const failed = r.checks.filter((x) => !x.pass).map((x) => `${x.name} (${x.detail})`);
  const ms = r.turns.reduce((s, t) => s + t.log.latencyMs.total, 0);
  const cost = r.turns.reduce((s, t) => s + t.log.costUsd, 0);
  const cells = [c.id, failed.length ? 'FAIL' : 'ok', last?.confidence.score.toFixed(2) ?? '-', last ? `${last.exactCount}/${last.results.length}` : '-', last?.interpreter ?? '-', ms, usd(cost), failed.join('; ')];
  console.log(row(cells));
}

const allChecks = results.flatMap((r) => r.checks);
const nlTurns = results.flatMap((r) => r.turns).filter((t) => t.message);
const classicTurns = results.flatMap((r) => r.turns).filter((t) => !t.message);
const tags = [...new Set(cases.flatMap((c) => c.tags))].sort();
const totalCost = nlTurns.reduce((s, t) => s + t.log.costUsd, 0);
const tokens = nlTurns.reduce((s, t) => ({ input: s.input + (t.log.tokens?.input ?? 0), output: s.output + (t.log.tokens?.output ?? 0) }), { input: 0, output: 0 });
const latency = (turns: Turn[], key: 'total' | 'llm') => ({ p50: pct(turns.map((t) => t.log.latencyMs[key]), 0.5), p95: pct(turns.map((t) => t.log.latencyMs[key]), 0.95) });

const summary = {
  label,
  date: today(),
  cases: { passed: results.filter((r) => r.checks.every((x) => x.pass)).length, total: results.length },
  checks: rate(allChecks),
  byTag: Object.fromEntries(tags.map((tag) => [tag, rate(results.filter((r) => r.c.tags.includes(tag)).flatMap((r) => r.checks))])),
  stateFieldAccuracy: rate(allChecks.filter((x) => x.name.startsWith('state.'))),
  top3HitRate: rate(allChecks.filter((x) => x.name === 'top3')),
  soldOutLeaks: results.reduce((s, r) => s + r.leaks.length, 0),
  deadEnds: results.reduce((s, r) => s + r.deadEnds, 0),
  errors: results.filter((r) => r.checks.some((x) => x.name === 'error')).length,
  // A turn the LLM should have read but the rule parser did (timeout, invalid output, API error).
  interpreterFallbacks: label === 'rules' ? 0 : nlTurns.filter((t) => t.response.interpreter !== 'llm').length,
  latencyMs: { assistantTurn: latency(nlTurns, 'total'), llmCall: latency(nlTurns, 'llm'), classicSearch: latency(classicTurns, 'total') },
  cost: { totalUsd: totalCost, perAssistantTurnUsd: nlTurns.length ? totalCost / nlTurns.length : 0, tokens },
  turns: { assistant: nlTurns.length, classic: classicTurns.length },
};

const { latencyMs: l } = summary;
console.log(`
Cases passed        ${summary.cases.passed}/${summary.cases.total}
Checks passed       ${summary.checks}
${tags.map((t) => `  ${t.padEnd(18)}${summary.byTag[t]}`).join('\n')}
State-field accuracy ${summary.stateFieldAccuracy}
Top-3 hit rate      ${summary.top3HitRate}
Sold-out leaks      ${summary.soldOutLeaks}   (must be 0)
Dead ends           ${summary.deadEnds}   (must be 0)
Errors              ${summary.errors}
LLM fallbacks       ${summary.interpreterFallbacks}/${nlTurns.length} assistant turns
Latency p50/p95     assistant turn ${l.assistantTurn.p50}/${l.assistantTurn.p95} ms, of which LLM ${l.llmCall.p50}/${l.llmCall.p95} ms; classic ${l.classicSearch.p50}/${l.classicSearch.p95} ms
Cost                ${usd(totalCost)} total, ${usd(summary.cost.perAssistantTurnUsd)} per assistant turn (${tokens.input} in / ${tokens.output} out tokens)`);

if (args.save) {
  const file = new URL(`results/${summary.date}-${label.replace(/[^\w.-]/g, '_')}.json`, import.meta.url);
  const details = results.map((r) => ({
    id: r.c.id,
    tags: r.c.tags,
    pass: r.checks.every((x) => x.pass),
    checks: r.checks,
    turns: r.turns.map(({ message, response: res, log }) => ({
      message,
      interpreter: res.interpreter,
      state: res.state,
      reply: res.reply,
      unmatched: res.unmatched,
      relaxed: res.relaxed.map((x) => x.field),
      confidence: res.confidence,
      exactCount: res.exactCount,
      results: res.results.map((x) => ({ tripId: x.trip.id, title: x.trip.title, exact: x.exact, confidence: x.confidence })),
      answerFaqs: res.answer?.faqs.map((f) => f.id) ?? [],
      latencyMs: log.latencyMs,
      tokens: log.tokens,
      costUsd: log.costUsd,
      error: log.error,
    })),
  }));
  await mkdir(new URL('results/', import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify({ summary, cases: details }, null, 2));
  console.log(`\nSaved ${file.pathname}`);
}

// The brief's non-negotiables (and crashes) gate the exit code; quality regressions are read from the report.
// Explicit exit because the ES client keeps the event loop alive; flush stdout first (pipes are async on macOS).
process.stdout.write('', () => process.exit(summary.soldOutLeaks || summary.deadEnds || summary.errors ? 1 : 0));
