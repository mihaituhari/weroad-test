import { readFile } from 'node:fs/promises';
import { bulkLoad } from './catalog.ts';
import { config, today } from './config.ts';
import { ensureIndices, es, INDEX, waitForEs } from './es.ts';
import type { Faq, Trip } from '../shared/types.ts';

// Data fixes applied on load. The samples stay untouched so the fixes are explicit and reviewable.

// 15 trips ship with continent=null, which would make "trips in Asia" miss Vietnam, Thailand, Bali...
const CONTINENT_BACKFILL: Record<string, string> = {
  Morocco: 'Africa', Egypt: 'Africa', Tunisia: 'Africa', Madagascar: 'Africa',
  Vietnam: 'Asia', Thailand: 'Asia', Indonesia: 'Asia', Philippines: 'Asia',
  Iceland: 'Europe', Sweden: 'Europe', Denmark: 'Europe', Latvia: 'Europe', Turkey: 'Europe',
  'Puerto Rico': 'America', 'Dominican Republic': 'America',
};

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** The export is from `exportedAt`; shift every departure by the time elapsed since, so the catalog stays in the future. */
export function prepareTrips(raw: { exportedAt: string; travels: Trip[] }, now = today()): Trip[] {
  const shift = config.shiftDates ? Math.max(0, Math.round((Date.parse(now) - Date.parse(raw.exportedAt)) / 86_400_000)) : 0;
  return raw.travels.map((t) => ({
    ...t,
    continent: t.continent ?? CONTINENT_BACKFILL[t.destination] ?? 'Other',
    shortDescription: t.shortDescription ?? null,
    tours: t.tours.map((d) => ({ ...d, startingDate: addDays(d.startingDate, shift), endingDate: addDays(d.endingDate, shift) })),
  }));
}

const readJson = async (file: string) => JSON.parse(await readFile(new URL(`../../samples/${file}`, import.meta.url), 'utf8'));

const STALE_DAYS = 7;

/** Seeds an empty catalog, or reseeds one whose dates were shifted more than a week ago (a long-running deploy). */
export async function seed({ force = false } = {}) {
  await ensureIndices();
  const { count } = await es.count({ index: INDEX.trips });
  const mapping = await es.indices.getMapping({ index: INDEX.trips });
  const seededOn = mapping[INDEX.trips]?.mappings._meta?.seededOn as string | undefined;
  const stale = config.shiftDates && seededOn && Date.parse(today()) - Date.parse(seededOn) > STALE_DAYS * 86_400_000;
  if (count > 0 && !force && !stale) return false;
  if (count > 0) await ensureIndices({ recreate: true });
  const [trips, faqs] = await Promise.all([readJson('trips.json'), readJson('faqs.json')]);
  await bulkLoad(prepareTrips(trips), faqs.faqs as Faq[]);
  await es.indices.putMapping({ index: INDEX.trips, _meta: { seededOn: today() } });
  return true;
}

if (import.meta.main) {
  await waitForEs();
  await seed({ force: process.argv.includes('--force') });
  console.log('Seeded trips and FAQs');
}
