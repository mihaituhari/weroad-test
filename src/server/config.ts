const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  esUrl: env.ES_URL ?? 'http://localhost:9200',
  kibanaUrl: env.KIBANA_URL || null, // public URL, linked from /admin
  kibanaInternalUrl: env.KIBANA_INTERNAL_URL ?? env.KIBANA_URL ?? null, // used to provision the data view
  anthropicKey: env.ANTHROPIC_API_KEY || null,
  model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', // chosen from the eval: Opus quality at half the cost, faster
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 10000), // then the rules parser answers
  shiftDates: env.SHIFT_DATES !== 'false',
  dailyLlmBudgetUsd: Number(env.DAILY_LLM_BUDGET_USD ?? 5), // past this, the assistant uses the rule-based parser
  version: (env.RAILWAY_GIT_COMMIT_SHA ?? env.APP_VERSION ?? 'dev').slice(0, 7),
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  modelCacheDir: env.MODEL_CACHE_DIR ?? '.cache/models',
};

/** USD per million tokens, for cost tracking in the search log. Update when pricing changes. */
export const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** "Today" (UTC) for bookability, date shift and the prompt. APP_TODAY pins it for reproducible demos/evals. */
export const today = () => env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
