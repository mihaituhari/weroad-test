import { z } from 'zod';
import { MOODS, PHYSICAL, type CatalogMeta, type SearchState } from '../../shared/types.ts';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SearchStateSchema = z.object({
  text: z.string().optional(),
  mustHave: z.array(z.string()).optional(),
  destinations: z.array(z.string()).optional(),
  continents: z.array(z.string()).optional(),
  travelTypes: z.array(z.string()).optional(),
  departFrom: date.optional(),
  departTo: date.optional(),
  returnBy: date.optional(),
  budgetMax: z.number().positive().optional(),
  durationMin: z.number().int().positive().optional(),
  durationMax: z.number().int().positive().optional(),
  physical: z.array(z.enum(PHYSICAL)).optional(),
  ageBands: z.array(z.string()).optional(),
  womenOnly: z.boolean().optional(),
  privateRoom: z.boolean().optional(),
  confirmedOnly: z.boolean().optional(),
  minSeats: z.number().int().positive().optional(),
  moods: z.object(Object.fromEntries(MOODS.map((m) => [m, z.number().min(0).max(1).optional()])) as Record<(typeof MOODS)[number], z.ZodOptional<z.ZodNumber>>).optional(),
  sort: z.enum(['relevance', 'price', 'date']).optional(),
});

export const SearchRequestSchema = z.object({
  sessionId: z.string().min(1).max(100),
  state: SearchStateSchema,
  message: z.string().trim().max(500).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(20).optional(),
});

const matchVocab = (values: string[] | undefined, vocab: string[], unmatched: string[]) => {
  if (!values) return undefined;
  const out = values.flatMap((v) => {
    const hit = vocab.find((w) => w.toLowerCase() === v.trim().toLowerCase());
    if (!hit) unmatched.push(v);
    return hit ? [hit] : [];
  });
  return out.length ? [...new Set(out)] : undefined;
};

/**
 * Makes a state safe to search: canonical vocabulary, no empty values, sane ranges.
 * Values the catalog doesn't know (e.g. destination "Antarctica") are moved to `unmatched`
 * instead of silently producing an impossible filter.
 */
export function normalizeState(input: SearchState, meta: CatalogMeta): { state: SearchState; unmatched: string[] } {
  const unmatched: string[] = [];
  const s: SearchState = {
    ...input,
    text: input.text?.trim() || undefined,
    mustHave: input.mustHave?.map((m) => m.trim()).filter(Boolean),
    destinations: matchVocab(input.destinations, meta.destinations.map((d) => d.name), unmatched),
    continents: matchVocab(input.continents, meta.continents, unmatched),
    travelTypes: matchVocab(input.travelTypes, meta.travelTypes, unmatched),
    ageBands: matchVocab(input.ageBands, meta.ageBands, unmatched),
  };
  if (s.durationMin && s.durationMax && s.durationMin > s.durationMax) [s.durationMin, s.durationMax] = [s.durationMax, s.durationMin];
  if (s.departFrom && s.departTo && s.departFrom > s.departTo) [s.departFrom, s.departTo] = [s.departTo, s.departFrom];
  if (s.moods) s.moods = Object.fromEntries(Object.entries(s.moods).filter(([, v]) => v != null && v > 0));
  // Drop empty values so logs, chips and the LLM context stay clean.
  for (const key of Object.keys(s) as (keyof SearchState)[]) {
    const v = s[key];
    if (v === undefined || v === false || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length)) delete s[key];
  }
  if (s.sort === 'relevance') delete s.sort;
  return { state: s, unmatched };
}

/** Masks emails and phone numbers (8+ digits) before the LLM call and the search log. */
export const redact = (text: string) =>
  text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[phone]' : m));
