import { describe, expect, it } from 'vitest';
import { parseRules } from './rules.ts';
import { normalizeState, redact } from './state.ts';
import type { CatalogMeta } from '../../shared/types.ts';

const meta: CatalogMeta = {
  destinations: [
    { name: 'Japan', continent: 'Asia' },
    { name: 'Iceland', continent: 'Europe' },
    { name: 'Morocco', continent: 'Africa' },
  ],
  continents: ['Africa', 'America', 'Asia', 'Europe'],
  travelTypes: ['Beach Life', 'Northern Lights'],
  ageBands: ['18-25', '25-35', '25-49'],
  priceRange: [200, 5000],
  durationRange: [3, 15],
  dateRange: ['2026-11-26', '2027-11-01'],
  kibanaUrl: null,
};
const TODAY = '2026-11-25';
const parse = (msg: string, current = {}) => parseRules(msg, current, meta, TODAY);

describe('rule-based parser (LLM fallback)', () => {
  it('reads an availability window in a past month as next year', () => {
    expect(parse('I only have 19-24 October')).toMatchObject({ departFrom: '2027-10-19', returnBy: '2027-10-24' });
  });

  it('crosses the year for "between December and February"', () => {
    expect(parse('between December and February')).toMatchObject({ departFrom: '2026-12-01', departTo: '2027-02-28' });
  });

  it('budget, group size, age and effort', () => {
    expect(parse('max 1.5k, we are 3 friends, I am 23, nothing too hard')).toMatchObject({
      budgetMax: 1500,
      minSeats: 3,
      ageBands: ['18-25'],
      physical: ['LOW', 'MEDIUM'],
    });
  });

  it('refinements keep earlier filters and replace the region when a new one is named', () => {
    expect(parse('actually make it Europe', { continents: ['Asia'], budgetMax: 2000 })).toEqual({ continents: ['Europe'], budgetMax: 2000 });
  });

  it('can loosen and remove filters', () => {
    expect(parse('ok, I can stretch to 2000', { budgetMax: 1000 })).toMatchObject({ budgetMax: 2000 });
    expect(parse('budget does not matter', { budgetMax: 1000 }).budgetMax).toBeUndefined();
  });

  it('must-haves, typos and leftover theme words', () => {
    expect(parse('only trips with a cooking class').mustHave).toEqual(['cooking class']);
    expect(parse('a trip to Japn').destinations).toEqual(['Japan']);
    expect(parse('sushi and temples').text).toBe('sushi temples');
  });

  it('start over clears everything', () => expect(parse('start over', { continents: ['Asia'] })).toEqual({}));
});

describe('normalizeState', () => {
  it('moves values the catalog does not know to unmatched instead of filtering on them', () => {
    const { state, unmatched } = normalizeState({ destinations: ['Antarctica', 'japan'], womenOnly: false, mustHave: [] }, meta);
    expect(state).toEqual({ destinations: ['Japan'] });
    expect(unmatched).toEqual(['Antarctica']);
  });
});

describe('redact', () => {
  it('masks contact details but keeps dates and prices', () => {
    expect(redact('mail me at anna.b@example.com or +39 333 123 4567, 19-24 October, max 1500')).toBe(
      'mail me at [email] or [phone], 19-24 October, max 1500',
    );
  });
});
