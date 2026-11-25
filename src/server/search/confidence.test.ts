import { describe, expect, it } from 'vitest';
import { isExact, levelOf, relevanceOf, resultConfidence, searchConfidence, textDecides, understandingOf } from './confidence.ts';
import type { Trip } from '../../shared/types.ts';

const trip = { moods: { party: 80, relax: 20, nature: 50, culture: 50, history: 50 } } as Trip;
const knn = (cosine: number) => (1 + cosine) / 2; // what ES returns for cosine similarity

describe('relevance', () => {
  it('is null when there is no free text and no vibe (relevance is not a factor)', () => {
    expect(relevanceOf(trip, { continents: ['Asia'] }, { lexical: 0, semantic: 0, coverage: 0, matchedTerms: [] }).relevance).toBeNull();
  });

  it('only claims "Mentions" when every word is found', () => {
    const partial = relevanceOf(trip, { text: 'sushi temples' }, { lexical: 8, semantic: knn(0.45), coverage: 0.5, matchedTerms: ['temples'] });
    expect(partial.reasons[0].text).toBe('Close to "sushi temples" (mentions temples)');
    const full = relevanceOf(trip, { text: 'temples' }, { lexical: 8, semantic: knn(0.3), coverage: 1, matchedTerms: ['temples'] });
    expect(full.reasons[0].text).toBe('Mentions "temples"');
  });

  it('an unrelated trip stays low', () => {
    const r = relevanceOf(trip, { text: 'penguins' }, { lexical: 0, semantic: knn(0.12), coverage: 0, matchedTerms: [] });
    expect(r.relevance).toBeLessThan(0.2);
    expect(r.reasons[0].ok).toBe(false);
  });

  it('scores the vibe from the trip mood scores', () => {
    const party = relevanceOf(trip, { moods: { party: 1 } }, { lexical: 0, semantic: 0, coverage: 0, matchedTerms: [] });
    const relax = relevanceOf(trip, { moods: { relax: 1 } }, { lexical: 0, semantic: 0, coverage: 0, matchedTerms: [] });
    expect(party.relevance!).toBeGreaterThan(relax.relevance!);
    expect(relax.reasons).toContainEqual({ ok: false, text: 'Not much relax (20/100)' });
  });
});

describe('text decides what counts as a match only when it is specific', () => {
  it('a text-only search is always decided by the text', () => expect(textDecides({ text: 'penguins' }, [0.1, 0.2])).toBe(true));
  it('with filters, a topic the catalog clearly has decides ("northern lights" + budget)', () =>
    expect(textDecides({ text: 'northern lights', budgetMax: 1000 }, [0.95, 0.1])).toBe(true));
  it('with filters, a vague word only nudges ("Asia, December, warm")', () => expect(textDecides({ text: 'warm', continents: ['Asia'] }, [0.6, 0.3])).toBe(false));

  it('a decisive topic with low relevance is not exact; a vague one is', () => {
    expect(isExact(true, 0.2, true)).toBe(false);
    expect(isExact(true, 0.2, false)).toBe(true);
    expect(resultConfidence(1, 0.2, true)).toBeLessThan(resultConfidence(1, 0.2, false));
  });
});

describe('search confidence', () => {
  it('understanding: classic search is certain, the fallback parser and unmatched requests are not', () => {
    expect(understandingOf({ interpreter: 'none', unmatched: [] })).toBe(1);
    expect(understandingOf({ interpreter: 'rules', unmatched: [] })).toBeLessThan(0.8);
    expect(understandingOf({ interpreter: 'llm', llmCertainty: 'high', unmatched: ['Antarctica'] })).toBeLessThan(0.85);
  });

  it('judges a single exact match on its own, not on the fillers below it', () => {
    const c = searchConfidence({ interpreter: 'none', unmatched: [], top: [0.95, 0.3, 0.3], exactCount: 1 });
    expect(c.level).toBe('high');
  });

  it('says plainly when nothing matches everything', () => {
    const c = searchConfidence({ interpreter: 'llm', llmCertainty: 'high', unmatched: [], top: [0.6, 0.5], exactCount: 0 });
    expect(c.explanation).toMatch(/No trip matches everything/);
    expect(levelOf(c.score)).not.toBe('high');
  });
});
