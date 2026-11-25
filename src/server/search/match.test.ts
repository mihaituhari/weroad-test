import { describe, expect, it } from 'vitest';
import { departureChecks, isBookable, matchTrip, relaxationsOf, type MatchContext } from './match.ts';
import type { Tour, Trip } from '../../shared/types.ts';

const TODAY = '2026-11-25';

const tour = (over: Partial<Tour> = {}): Tour => ({
  id: 't',
  startingDate: '2026-12-10',
  endingDate: '2026-12-14',
  priceEur: 1000,
  basePriceEur: null,
  salesStatus: 'CONFIRMED',
  isConfirmed: true,
  maxPax: 14,
  seatsLeft: 5,
  paxBooked: 9,
  privateRoomBookable: true,
  isWomenOnly: false,
  ageBand: '25-35',
  ...over,
});

const trip = (tours: Tour[], over: Partial<Trip> = {}): Trip => ({
  id: 1,
  slug: 'x',
  url: '',
  title: 'Trip',
  destination: 'Japan',
  continent: 'Asia',
  destinationLabel: 'Tokyo',
  numberOfDays: 5,
  startingPlace: '',
  endingPlace: '',
  travelStyle: 'Classic',
  travelTypes: ['360°'],
  moods: { party: 50, relax: 50, nature: 50, culture: 50, history: 50 },
  physicalRating: 'MEDIUM',
  shortDescription: null,
  description: '',
  rating: null,
  itinerary: [],
  tours,
  ...over,
});

const ctx: MatchContext = { matchedMustHave: new Set(), continentOf: (d) => ({ Japan: 'Asia', Korea: 'Asia', Peru: 'America' })[d] };

describe('isBookable — sold-out departures are never shown', () => {
  it.each([
    ['sold out', tour({ salesStatus: 'SOLD_OUT', seatsLeft: 0 })],
    ['waiting list', tour({ salesStatus: 'WAITING_LIST' })],
    ['closed for sale', tour({ salesStatus: 'NOT_AVAILABLE', seatsLeft: 4 })],
    ['no seats left despite an open status', tour({ salesStatus: 'ALMOST_FULL', seatsLeft: 0 })],
    ['departs today', tour({ startingDate: TODAY })],
    ['in the past', tour({ startingDate: '2026-11-01' })],
  ])('rejects %s', (_, t) => expect(isBookable(t, TODAY)).toBe(false));

  it('accepts an open future departure with seats', () => expect(isBookable(tour(), TODAY)).toBe(true));

  it('a trip with only non-bookable departures is not a result at all', () => {
    expect(matchTrip(trip([tour({ salesStatus: 'SOLD_OUT', seatsLeft: 0 })]), {}, ctx, TODAY)).toBeNull();
  });

  it('never returns a non-bookable departure, even when it is the best fit', () => {
    const soldOutInWindow = tour({ id: 'sold', startingDate: '2026-12-01', salesStatus: 'SOLD_OUT', seatsLeft: 0 });
    const openLater = tour({ id: 'open', startingDate: '2026-12-20', endingDate: '2026-12-24' });
    const m = matchTrip(trip([soldOutInWindow, openLater]), { departFrom: '2026-12-01', departTo: '2026-12-02' }, ctx, TODAY)!;
    expect(m.departures.map((d) => d.id)).toEqual(['open']);
  });
});

describe('penalties grow with distance', () => {
  const penalty = (s: Parameters<typeof departureChecks>[1], t = tour()) => departureChecks(t, s)[0].penalty;

  it('dates: a few days off is closer than weeks off', () => {
    expect(penalty({ departFrom: '2026-12-10', departTo: '2026-12-10' })).toBe(0);
    const near = penalty({ departFrom: '2026-12-12', departTo: '2026-12-12' });
    const far = penalty({ departFrom: '2027-01-10', departTo: '2027-01-10' });
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('dates: "I only have 19-24" rejects a trip that ends after the window', () => {
    expect(penalty({ departFrom: '2026-12-10', returnBy: '2026-12-14' })).toBe(0);
    expect(penalty({ departFrom: '2026-12-10', returnBy: '2026-12-12' })).toBeGreaterThan(0);
  });

  it('budget: 10% over is closer than 50% over', () => {
    expect(penalty({ budgetMax: 1000 })).toBe(0);
    expect(penalty({ budgetMax: 900 })).toBeLessThan(penalty({ budgetMax: 700 }));
  });

  it('group size: not enough seats is a strong mismatch', () => {
    expect(penalty({ minSeats: 6 })).toBeGreaterThanOrEqual(0.5);
  });
});

describe('matchTrip', () => {
  it('is exact when every hard constraint holds, and picks the best departure', () => {
    const cheap = tour({ id: 'cheap', priceEur: 800 });
    const pricey = tour({ id: 'pricey', priceEur: 1500 });
    const m = matchTrip(trip([pricey, cheap]), { continents: ['Asia'], budgetMax: 1000 }, ctx, TODAY)!;
    expect(m.meetsAll).toBe(true);
    expect(m.departures[0].id).toBe('cheap');
  });

  it('age band is a soft preference: ranks lower, still a match (FAQ: age is a guide, not a rule)', () => {
    const m = matchTrip(trip([tour({ ageBand: '25-49' })]), { ageBands: ['18-25'] }, ctx, TODAY)!;
    expect(m.meetsAll).toBe(true);
    expect(m.match).toBeLessThan(1);
  });

  it('a destination on the same continent is closer than one on another continent', () => {
    const korea = matchTrip(trip([tour()], { destination: 'Korea' }), { destinations: ['Japan'] }, ctx, TODAY)!;
    const peru = matchTrip(trip([tour()], { destination: 'Peru', continent: 'America' }), { destinations: ['Japan'] }, ctx, TODAY)!;
    expect(korea.match).toBeGreaterThan(peru.match);
  });

  it('says "not published yet" when the window is after the last listed departure', () => {
    const m = matchTrip(trip([tour()]), { departFrom: '2027-06-01', departTo: '2027-06-30' }, ctx, TODAY)!;
    expect(m.checks.find((c) => c.field === 'departFrom')!.reason.text).toMatch(/not published yet/);
  });

  it('explains what was relaxed', () => {
    const m = matchTrip(trip([tour({ priceEur: 1200 })]), { budgetMax: 1000, womenOnly: true }, ctx, TODAY)!;
    const notes = relaxationsOf([m]).map((r) => r.note).join(' | ');
    expect(notes).toMatch(/budget — up to 20% over/);
    expect(notes).toMatch(/women-only/);
  });
});
