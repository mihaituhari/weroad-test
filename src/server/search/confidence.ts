import { MOODS, type Confidence, type ConfidenceLevel, type Reason, type SearchState, type Trip } from '../../shared/types.ts';

// Confidence = how much we'd bet the visitor would call this a good result.
// Built from signals we can explain, not from an LLM's self-assessment alone:
//   result:  constraint match (match.ts) × text/mood relevance
//   search:  understanding of the request × quality of the top results
// Calibration constants come from running eval/ against the catalog; re-check them when the embedding model changes.

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** BM25 has no upper bound: saturate it, and scale by the share of query words the trip mentions. */
export const lexicalRelevance = (bm25: number, coverage: number) => (bm25 > 0 ? coverage * (bm25 / (bm25 + 5)) : 0);
/**
 * ES returns (1 + cosine) / 2 for cosine kNN. Measured on this catalog with MiniLM (short query vs long
 * trip text): unrelated trips sit at cosine 0.1-0.2, clearly related ones at 0.35-0.5.
 */
export const semanticRelevance = (knnScore: number) => clamp((2 * knnScore - 1 - 0.2) / 0.3);

export interface RelevanceSignals {
  lexical: number; // raw BM25 of the free text
  semantic: number; // raw kNN score
  coverage: number; // share of the free-text words the trip mentions
  matchedTerms: string[];
}

/** null when the search has no free text and no vibe: relevance is then not a factor. */
export function relevanceOf(trip: Trip, s: SearchState, signals: RelevanceSignals): { relevance: number | null; reasons: Reason[] } {
  const reasons: Reason[] = [];
  let text: number | null = null;
  if (s.text) {
    const lex = lexicalRelevance(signals.lexical, signals.coverage);
    const sem = semanticRelevance(signals.semantic);
    text = 1 - (1 - lex) * (1 - sem); // either strong signal is enough
    const partial = signals.coverage > 0 && signals.coverage < 1 ? ` (mentions ${signals.matchedTerms.join(', ')})` : '';
    reasons.push(
      signals.coverage === 1 && lex >= 0.4
        ? { ok: true, text: `Mentions "${s.text}"` }
        : text >= RELEVANT
          ? { ok: true, text: `Close to "${s.text}"${partial}` }
          : { ok: false, text: `Only loosely related to "${s.text}"${partial}` },
    );
  }
  let mood: number | null = null;
  const wanted = MOODS.filter((m) => (s.moods?.[m] ?? 0) > 0);
  if (wanted.length) {
    const weight = wanted.reduce((sum, m) => sum + s.moods![m]!, 0);
    mood = wanted.reduce((sum, m) => sum + (s.moods![m]! * trip.moods[m]) / 100, 0) / weight;
    for (const m of wanted) {
      const score = trip.moods[m];
      if (score >= 55) reasons.push({ ok: true, text: `Great for ${m} (${score}/100)` });
      else if (score < 35) reasons.push({ ok: false, text: `Not much ${m} (${score}/100)` });
    }
    // Mood scores rarely reach 100: rescale so a strong fit (~70) counts as a full match.
    mood = clamp(mood / 0.7);
  }
  const relevance = text !== null && mood !== null ? 0.65 * text + 0.35 * mood : (text ?? mood);
  return { relevance, reasons };
}

/** Below this relevance a text-only result is a "closest option", not a match. */
export const RELEVANT = 0.5;

const SOFT: (keyof SearchState)[] = ['text', 'moods', 'sort'];
/** True when the search has hard constraints besides free text and vibe. */
export const hasFilters = (s: SearchState) => (Object.keys(s) as (keyof SearchState)[]).some((k) => !SOFT.includes(k));

/** Relevance that proves the catalog really has the topic ("northern lights" → Iceland ≈ 1.0, "warm" → nothing above ~0.6). */
const STRONG = 0.8;

/**
 * Does the free text / vibe decide what counts as a match? Yes when it is the whole search, or when the
 * catalog clearly has that topic ("northern lights" + a budget: trips under budget without auroras are not
 * matches). No when filters do the work and the words are vague ("Asia, December, something warm": we can't
 * verify "warm", so it only nudges ranking and confidence).
 */
export const textDecides = (s: SearchState, relevances: (number | null)[]) => !hasFilters(s) || relevances.some((r) => r !== null && r >= STRONG);

export const resultConfidence = (match: number, relevance: number | null, decisive: boolean) =>
  match * (relevance === null ? 1 : 1 - (decisive ? 0.8 : 0.4) * (1 - relevance));

/** A closest option is never "high": its badge must agree with "no exact match". */
export const CLOSEST_MAX = 0.7;

export const isExact = (meetsAll: boolean, relevance: number | null, decisive: boolean) =>
  meetsAll && (relevance === null || !decisive || relevance >= RELEVANT);

export const levelOf = (score: number): ConfidenceLevel => (score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low');

export interface UnderstandingInput {
  interpreter: 'llm' | 'rules' | 'none';
  llmCertainty?: 'high' | 'medium' | 'low';
  unmatched: string[];
}

/** How sure we are that the state reflects what the visitor asked for. */
export function understandingOf({ interpreter, llmCertainty, unmatched }: UnderstandingInput) {
  const base = interpreter === 'none' ? 1 : interpreter === 'llm' ? { high: 1, medium: 0.8, low: 0.55 }[llmCertainty ?? 'medium'] : 0.7;
  return base * 0.8 ** unmatched.length;
}

export function searchConfidence(input: UnderstandingInput & { top: number[]; exactCount: number }): Confidence {
  const understanding = understandingOf(input);
  // If only one trip can match (e.g. a single destination), judge that one, not the fillers below it.
  const top = input.top.slice(0, input.exactCount ? Math.min(3, input.exactCount) : 3);
  const matchQuality = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  const score = understanding * matchQuality;
  const parts = [
    input.exactCount > 0
      ? `${input.exactCount} trip${input.exactCount > 1 ? 's match' : ' matches'} everything you asked for.`
      : 'No trip matches everything you asked for, so these are the closest options.',
  ];
  if (input.unmatched.length) parts.push(`We can't search for: ${input.unmatched.join(', ')}.`);
  if (input.interpreter === 'rules') parts.push('The AI assistant is unavailable, so we used basic keyword matching to read your message.');
  else if (input.interpreter === 'llm' && input.llmCertainty !== 'high') parts.push('Parts of your request were ambiguous: check the filters we applied.');
  return { score, level: levelOf(score), explanation: parts.join(' '), understanding, matchQuality };
}
