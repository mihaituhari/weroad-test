import { z } from 'zod';
import { es, INDEX } from './es.ts';
import { config } from './config.ts';
import { LLM_MODELS, type LlmModel, type Settings } from '../shared/types.ts';

// Runtime settings: one ES document, edited in /admin. Environment variables are the defaults.

export const SettingsSchema = z.object({
  llmModel: z.enum(LLM_MODELS),
  dailyLlmBudgetUsd: z.number().min(0).max(1000),
  llmTimeoutMs: z.number().int().min(1000).max(60_000),
});

export const defaults = (): Settings => ({
  llmModel: (LLM_MODELS as readonly string[]).includes(config.model) ? (config.model as LlmModel) : 'claude-sonnet-5-5',
  dailyLlmBudgetUsd: config.dailyLlmBudgetUsd,
  llmTimeoutMs: config.llmTimeoutMs,
});

const ID = 'app';
const TTL_MS = 30_000; // other instances pick up a change within this
let cache: { value: Settings; updatedAt: string | null; at: number } | null = null;

export async function getSettings(): Promise<{ settings: Settings; updatedAt: string | null }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { settings: cache.value, updatedAt: cache.updatedAt };
  const res = await es.get<Settings & { updatedAt: string }>({ index: INDEX.settings, id: ID }, { ignore: [404] });
  const saved = res.found ? res._source! : null;
  // A saved value that no longer validates (e.g. a retired model) falls back to the default for that field.
  const parsed = SettingsSchema.partial().safeParse(saved ?? {});
  const value = { ...defaults(), ...(parsed.success ? parsed.data : {}) };
  cache = { value, updatedAt: saved?.updatedAt ?? null, at: Date.now() };
  return { settings: value, updatedAt: cache.updatedAt };
}

export async function saveSettings(input: unknown) {
  const settings = SettingsSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await es.index({ index: INDEX.settings, id: ID, document: { ...settings, updatedAt }, refresh: 'wait_for' });
  cache = { value: settings, updatedAt, at: Date.now() };
  return { settings, updatedAt };
}
