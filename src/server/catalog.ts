import { z } from 'zod';
import { es, INDEX } from './es.ts';
import { embed, embedOne, faqText, tripText } from './embeddings.ts';
import { today } from './config.ts';
import { kibanaDiscoverUrl } from './kibana.ts';
import { BOOKABLE_STATUSES, MOODS, PHYSICAL, SALES_STATUSES, type CatalogMeta, type Faq, type Trip } from '../shared/types.ts';

// Trips and FAQs: validation, CRUD (re-embedding on write) and the vocabulary the search uses.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const TourSchema = z.object({
  id: z.string().min(1),
  startingDate: isoDate,
  endingDate: isoDate,
  priceEur: z.number().int().nonnegative(),
  basePriceEur: z.number().int().nonnegative().nullable(),
  salesStatus: z.enum(SALES_STATUSES),
  isConfirmed: z.boolean(),
  maxPax: z.number().int().positive(),
  seatsLeft: z.number().int().nonnegative(),
  paxBooked: z.number().int().nonnegative(),
  privateRoomBookable: z.boolean(),
  isWomenOnly: z.boolean(),
  ageBand: z.string().min(1),
});

export const TripSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  url: z.string(),
  title: z.string().min(1),
  destination: z.string().min(1),
  continent: z.string().min(1),
  destinationLabel: z.string().min(1),
  numberOfDays: z.number().int().positive(),
  startingPlace: z.string(),
  endingPlace: z.string(),
  arrivalAirport: z.object({ code: z.string(), city: z.string() }).nullable().optional(),
  travelStyle: z.string(),
  travelTypes: z.array(z.string()),
  moods: z.object(Object.fromEntries(MOODS.map((m) => [m, z.number().min(0).max(100)])) as Record<(typeof MOODS)[number], z.ZodNumber>),
  physicalRating: z.enum(PHYSICAL),
  shortDescription: z.string().nullable(),
  description: z.string(),
  rating: z.object({ value: z.number(), count: z.number().int() }).nullable(),
  itinerary: z.array(z.object({ day: z.number().int(), title: z.string(), nights: z.string().nullable(), highlights: z.array(z.string()) })),
  tours: z.array(TourSchema),
});

export const FaqSchema = z.object({
  id: z.number().int().positive(),
  scope: z.enum(['general', 'destination']),
  destination: z.string().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().nullable(),
});

// ---------- Trips ----------

export async function listTrips(q?: string): Promise<Trip[]> {
  const res = await es.search<Trip>({
    index: INDEX.trips,
    size: 500,
    sort: q ? undefined : [{ id: 'asc' }],
    query: q ? { multi_match: { query: q, fields: ['title^2', 'destination', 'destinationLabel', 'continent'] } } : { match_all: {} },
    _source: { excludes: ['embedding'] },
  });
  return res.hits.hits.map((h) => h._source!);
}

export async function getTrip(id: number): Promise<Trip | null> {
  const res = await es.get<Trip>({ index: INDEX.trips, id: String(id), _source_excludes: ['embedding'] }, { ignore: [404] });
  return res.found ? res._source! : null;
}

export async function saveTrip(input: unknown): Promise<Trip> {
  const trip = TripSchema.parse(input) as Trip;
  await es.index({ index: INDEX.trips, id: String(trip.id), document: { ...trip, embedding: await embedOne(tripText(trip)) }, refresh: 'wait_for' });
  invalidateMeta();
  return trip;
}

export async function deleteTrip(id: number) {
  await es.delete({ index: INDEX.trips, id: String(id), refresh: 'wait_for' }, { ignore: [404] });
  invalidateMeta();
}

export async function nextId(index: string): Promise<number> {
  const res = await es.search({ index, size: 0, aggs: { max: { max: { field: 'id' } } } });
  return ((res.aggregations?.max as { value: number | null })?.value ?? 0) + 1;
}

// ---------- FAQs ----------

export async function listFaqs(destination?: string): Promise<Faq[]> {
  const res = await es.search<Faq>({
    index: INDEX.faqs,
    size: 500,
    sort: [{ id: 'asc' }],
    query: destination ? { term: { destination } } : { match_all: {} },
    _source: { excludes: ['embedding'] },
  });
  return res.hits.hits.map((h) => h._source!);
}

export async function saveFaq(input: unknown): Promise<Faq> {
  const faq = FaqSchema.parse(input) as Faq;
  await es.index({ index: INDEX.faqs, id: String(faq.id), document: { ...faq, embedding: await embedOne(faqText(faq)) }, refresh: 'wait_for' });
  return faq;
}

export async function deleteFaq(id: number) {
  await es.delete({ index: INDEX.faqs, id: String(id), refresh: 'wait_for' }, { ignore: [404] });
}

// ---------- Bulk load (seed) ----------

export async function bulkLoad(trips: Trip[], faqs: Faq[]) {
  const [tripVectors, faqVectors] = await Promise.all([embed(trips.map(tripText)), embed(faqs.map(faqText))]);
  const operations = [
    ...trips.flatMap((t, i) => [{ index: { _index: INDEX.trips, _id: String(t.id) } }, { ...TripSchema.parse(t), embedding: tripVectors[i] }]),
    ...faqs.flatMap((f, i) => [{ index: { _index: INDEX.faqs, _id: String(f.id) } }, { ...FaqSchema.parse(f), embedding: faqVectors[i] }]),
  ];
  const res = await es.bulk({ operations, refresh: 'wait_for' });
  if (res.errors) throw new Error(JSON.stringify(res.items.find((i) => i.index?.error)?.index?.error));
  invalidateMeta();
}

// ---------- Vocabulary ----------

let metaCache: Promise<CatalogMeta> | null = null;
export const invalidateMeta = () => (metaCache = null);
export const getMeta = () => (metaCache ??= buildMeta().catch((err) => ((metaCache = null), Promise.reject(err))));

async function buildMeta(): Promise<CatalogMeta> {
  const trips = await listTrips();
  const bookable = trips.flatMap((t) => t.tours.filter((d) => BOOKABLE_STATUSES.includes(d.salesStatus) && d.seatsLeft > 0 && d.startingDate > today()));
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const prices = bookable.map((d) => d.priceEur);
  const days = trips.map((t) => t.numberOfDays);
  const dates = bookable.map((d) => d.startingDate).sort();
  return {
    destinations: uniq(trips.map((t) => t.destination)).map((name) => ({ name, continent: trips.find((t) => t.destination === name)!.continent })),
    continents: uniq(trips.map((t) => t.continent)),
    travelTypes: uniq(trips.flatMap((t) => t.travelTypes)),
    ageBands: uniq(trips.flatMap((t) => t.tours.map((d) => d.ageBand))),
    priceRange: [Math.min(...prices), Math.max(...prices)],
    durationRange: [Math.min(...days), Math.max(...days)],
    dateRange: [dates[0] ?? today(), dates.at(-1) ?? today()],
    kibanaUrl: kibanaDiscoverUrl(),
  };
}
