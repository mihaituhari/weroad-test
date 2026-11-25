import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { LLM_MODELS, type LlmModel, type Settings } from '../../shared/types.ts';
import { Alert, Field, useAction, useLoad } from './ui.tsx';

// Runtime settings. Saved in Elasticsearch, applied to the next search; .env values are the defaults.

const MODELS: Record<LlmModel, { label: string; about: string }> = {
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5',
    about: 'Best quality in our eval (all checks passed), about 2.5 s and $0.005 per assistant turn.',
  },
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5',
    about: 'About 15× cheaper ($0.0003 per turn), about 2.2 s. In our eval it missed a few phrasings (e.g. "at least two weeks").',
  },
  none: {
    label: 'None (rule-based parser only)',
    about: 'No LLM calls and no cost, about 20 ms. Understands common patterns only, cannot flag requests we don’t sell, and answers FAQs less precisely. Confidence is lowered accordingly.',
  },
};

const usd = (n: number) => `$${n.toFixed(4)}`;

export function SettingsTab() {
  const view = useLoad(api.admin.settings, []);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction(() => setSaved(true));
  useEffect(() => setDraft(view.data?.settings ?? null), [view.data]);

  if (!view.data || !draft) return <>{view.error ? <Alert error={view.error} /> : <p className="adm-muted">Loading…</p>}</>;
  const { defaults, updatedAt, apiKeyConfigured, spentTodayUsd } = view.data;
  const set = (patch: Partial<Settings>) => (setSaved(false), setDraft({ ...draft, ...patch }));
  const save = (e: FormEvent) => {
    e.preventDefault();
    action.run(async () => {
      await api.admin.saveSettings(draft);
      view.reload();
    });
  };
  const usesLlm = draft.llmModel !== 'none';

  return (
    <form className="adm-editor" onSubmit={save}>
      <section className="adm-card">
        <h3>Assistant</h3>
        {!apiKeyConfigured && usesLlm && (
          <p className="adm-alert">No ANTHROPIC_API_KEY is configured, so the rule-based parser answers whatever model is selected here.</p>
        )}
        <div className="adm-form adm-settings">
          <Field label="Model that reads visitor messages" wide>
            <select value={draft.llmModel} onChange={(e) => set({ llmModel: e.target.value as LlmModel })}>
              {LLM_MODELS.map((m) => (
                <option key={m} value={m}>
                  {MODELS[m].label}
                  {m === defaults.llmModel ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <span className="adm-hint">{MODELS[draft.llmModel].about}</span>
          </Field>
          <Field label="Daily LLM budget (USD)">
            <input
              type="number"
              min={0}
              max={1000}
              step={0.5}
              required
              disabled={!usesLlm}
              value={draft.dailyLlmBudgetUsd}
              onChange={(e) => set({ dailyLlmBudgetUsd: Number(e.target.value) })}
            />
            <span className="adm-hint">
              Spent today: {usd(spentTodayUsd)}. Past the budget, the rule-based parser answers until midnight UTC. Default {usd(defaults.dailyLlmBudgetUsd)}.
            </span>
          </Field>
          <Field label="LLM timeout (seconds)">
            <input
              type="number"
              min={1}
              max={60}
              step={0.5}
              required
              disabled={!usesLlm}
              value={draft.llmTimeoutMs / 1000}
              onChange={(e) => set({ llmTimeoutMs: Math.round(Number(e.target.value) * 1000) })}
            />
            <span className="adm-hint">After this the rule-based parser answers, so visitors never wait longer. Default {defaults.llmTimeoutMs / 1000} s.</span>
          </Field>
        </div>
      </section>

      <div className="adm-bar">
        <Alert error={action.error} />
        <button type="submit" className="adm-btn adm-btn--primary" disabled={action.busy}>
          {action.busy ? 'Saving…' : 'Save settings'}
        </button>
        <button type="button" className="adm-btn" onClick={() => set(defaults)}>
          Restore defaults
        </button>
        <span className="adm-muted">
          {saved ? 'Saved: applies to the next search.' : updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString('en-GB')}` : 'Using defaults from the environment (.env).'}
        </span>
      </div>
    </form>
  );
}
