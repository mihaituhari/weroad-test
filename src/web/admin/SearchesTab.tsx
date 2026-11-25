import { Fragment, useState } from 'react';
import { api } from '../api.ts';
import type { SearchLog, SearchLogQuery, SearchState } from '../../shared/types.ts';
import { Alert, Field, pct, useLoad } from './ui.tsx';

const PAGE_SIZE = 25;
const usd = (n: number) => `$${n.toFixed(4)}`;
const pad = (n: number) => String(n).padStart(2, '0');
/** d/m/Y H:i in the viewer's timezone, e.g. 25/11/2026 17:07. */
const when = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const voteIcon = (vote: 'up' | 'down' | null | undefined) => (vote === 'up' ? '👍' : vote === 'down' ? '👎' : '—');

/** One line for a classic search, e.g. "text: hiking · continents: Asia · budgetMax: 1800". */
const summarize = (s: SearchState) =>
  Object.entries(s)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ') || 'empty search';

export function SearchesTab() {
  const [query, setQuery] = useState<SearchLogQuery>({});
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const stats = useLoad(api.admin.stats, []);
  const logs = useLoad(() => api.admin.searches({ ...query, page }), [query, page], 250); // debounced for the text filter

  const filter = (patch: SearchLogQuery) => {
    setQuery((q) => ({ ...q, ...patch }));
    setPage(1);
  };
  const refresh = () => {
    stats.reload();
    logs.reload();
  };
  const pages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / PAGE_SIZE));
  const s = stats.data;

  return (
    <>
      <Alert error={stats.error ?? logs.error} />
      {s && (
        <>
          <div className="adm-stats">
            <Stat label="Searches" value={s.total} />
            <Stat label="Assistant share" value={pct(s.assistantShare)} />
            <Stat label="Zero exact results" value={pct(s.zeroExactRate)} />
            <Stat label="Avg confidence" value={pct(s.avgConfidence)} />
            <Stat label="Feedback" value={`👍 ${s.feedbackUp} · 👎 ${s.feedbackDown}`} />
            <Stat label="Opened a trip (CTR)" value={pct(s.ctr)} />
            <Stat label="Zero-exact rescued" value={pct(s.rescueRate)} />
            <Stat label="Latency p50 / p95" value={`${ms(s.latencyP50)} / ${ms(s.latencyP95)}`} />
            <Stat label="LLM cost" value={usd(s.totalCostUsd)} />
          </div>
          <div className="adm-split">
            <TopList title="Unmatched requests" items={s.topUnmatched.map((u) => [u.term, u.count])} onPick={(q) => filter({ q })} />
            <TopList title="Zero-result queries" items={s.topZeroQueries.map((z) => [z.message, z.count])} onPick={(q) => filter({ q })} />
          </div>
          <p className="adm-hint">
            What visitors asked for and we could not serve: the backlog for improving the interpreter, the synonyms and the catalog. Click one to filter the log.
          </p>
          <div className="adm-card adm-calibration">
            <h3>Is our confidence honest?</h3>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Confidence</th>
                  <th>Searches</th>
                  <th>Opened a trip</th>
                  <th>👍 rate</th>
                </tr>
              </thead>
              <tbody>
                {s.byLevel.map((l) => (
                  <tr key={l.level}>
                    <td>{l.level}</td>
                    <td>{l.searches}</td>
                    <td>{pct(l.ctr)}</td>
                    <td>{l.upRate === null ? '–' : pct(l.upRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="adm-hint">High-confidence searches should be opened and up-voted more often than low ones. If they aren't, the scoring needs recalibrating.</p>
          </div>
        </>
      )}

      <div className="adm-filters">
        <Field label="Search text">
          <input type="search" value={query.q ?? ''} onChange={(e) => filter({ q: e.target.value })} placeholder="message, reply, unmatched, trip" />
        </Field>
        <Choice label="Mode" value={query.mode} options={['classic', 'assistant']} onChange={(v) => filter({ mode: v as SearchLogQuery['mode'] })} />
        <Choice label="Confidence" value={query.level} options={['high', 'medium', 'low']} onChange={(v) => filter({ level: v as SearchLogQuery['level'] })} />
        <Choice
          label="Zero exact"
          value={query.zeroExact === undefined ? undefined : query.zeroExact ? 'yes' : 'no'}
          options={['yes', 'no']}
          onChange={(v) => filter({ zeroExact: v === undefined ? undefined : v === 'yes' })}
        />
        <Choice label="Feedback" value={query.feedback} options={['up', 'down', 'none']} onChange={(v) => filter({ feedback: v as SearchLogQuery['feedback'] })} />
        <Choice label="Interpreter" value={query.interpreter} options={['llm', 'rules', 'none']} onChange={(v) => filter({ interpreter: v as SearchLogQuery['interpreter'] })} />
        <Field label="From">
          <input type="date" value={query.from ?? ''} onChange={(e) => filter({ from: e.target.value || undefined })} />
        </Field>
        <Field label="To">
          <input type="date" value={query.to ?? ''} onChange={(e) => filter({ to: e.target.value || undefined })} />
        </Field>
        <button className="adm-btn" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Mode</th>
              <th>Search</th>
              <th>Interpreter</th>
              <th className="adm-num">Exact / total</th>
              <th>Confidence</th>
              <th>Feedback</th>
              <th className="adm-num">Latency</th>
              <th className="adm-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((log) => (
              <Fragment key={log.id}>
                <tr className={`adm-row${open === log.id ? ' adm-row--open' : ''}`} onClick={() => setOpen(open === log.id ? null : log.id)}>
                  <td className="adm-nowrap">{when(log.at)}</td>
                  <td>
                    <span className={`adm-tag adm-tag--${log.mode}`}>{log.mode}</span>
                  </td>
                  <td className="adm-ellipsis" title={log.message ?? summarize(log.stateOut)}>
                    {log.message ?? <span className="adm-muted">{summarize(log.stateOut)}</span>}
                  </td>
                  <td>{log.interpreter}</td>
                  <td className="adm-num">
                    {log.exactCount}/{log.resultCount}
                  </td>
                  <td>
                    <span className={`adm-badge adm-badge--${log.confidenceLevel}`}>{pct(log.confidence)}</span>
                  </td>
                  <td>
                    {voteIcon(log.feedback.vote)}
                    {log.feedback.comment && ' 💬'}
                  </td>
                  <td className="adm-num">{log.latencyMs.total} ms</td>
                  <td className="adm-num">{usd(log.costUsd)}</td>
                </tr>
                {open === log.id && (
                  <tr>
                    <td colSpan={9}>
                      <Details log={log} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {logs.data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="adm-empty">
                  No searches match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-pager">
        <button className="adm-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ‹ Prev
        </button>
        <span>
          Page {page} of {pages} · {logs.data?.total ?? 0} searches
        </span>
        <button className="adm-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next ›
        </button>
      </div>
    </>
  );
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="adm-card adm-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

function TopList({ title, items, onPick }: { title: string; items: [string, number][]; onPick: (text: string) => void }) {
  return (
    <div className="adm-card">
      <h3>{title}</h3>
      {items.length ? (
        <ol className="adm-toplist">
          {items.map(([text, count]) => (
            <li key={text}>
              <button className="adm-link" onClick={() => onPick(text)}>
                {text}
              </button>
              <span className="adm-muted">{count}×</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="adm-muted">Nothing yet.</p>
      )}
    </div>
  );
}

/** Select with an "any" option; empty value means no filter. */
function Choice({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string | undefined) => void }) {
  return (
    <Field label={label}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">any</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </Field>
  );
}

function Details({ log }: { log: SearchLog }) {
  const votes = new Map(log.feedback.results.map((r) => [r.tripId, r.vote]));
  const { total, llm, search } = log.latencyMs;
  return (
    <div className="adm-details">
      <dl>
        {log.message && (
          <>
            <dt>Message</dt>
            <dd>{log.message}</dd>
          </>
        )}
        {log.reply && (
          <>
            <dt>Reply</dt>
            <dd>{log.reply}</dd>
          </>
        )}
        <dt>Unmatched</dt>
        <dd>{log.unmatched.join(', ') || '—'}</dd>
        <dt>Relaxed</dt>
        <dd>{log.relaxed.join(', ') || '—'}</dd>
        <dt>FAQs used</dt>
        <dd>
          {log.faqIds.length
            ? log.faqIds.map((id) => (
                <a key={id} href={`#faqs/${id}`} className="adm-chip">
                  #{id}
                </a>
              ))
            : '—'}
        </dd>
        <dt>Model</dt>
        <dd>{log.model ?? '—'}</dd>
        <dt>Latency</dt>
        <dd>
          {total} ms total · {llm} ms LLM · {search} ms search
        </dd>
        <dt>Tokens</dt>
        <dd>
          {log.tokens ? `${log.tokens.input} in · ${log.tokens.output} out · ${log.tokens.cacheRead} cache read` : '—'} · {usd(log.costUsd)}
        </dd>
        {log.error && (
          <>
            <dt>Error</dt>
            <dd className="adm-error">{log.error}</dd>
          </>
        )}
        <dt>Feedback</dt>
        <dd>
          {voteIcon(log.feedback.vote)} {log.feedback.comment && `“${log.feedback.comment}”`}
        </dd>
        <dt>Session</dt>
        <dd className="adm-muted">{log.sessionId}</dd>
      </dl>

      <div>
        <h4>Results</h4>
        {log.results.length ? (
          <ol className="adm-results">
            {log.results.map((r) => (
              <li key={r.tripId}>
                <a href={`#trips/${r.tripId}`}>{r.title}</a> <span className="adm-muted">{pct(r.confidence)}</span>{' '}
                {r.exact ? <span className="adm-tag adm-tag--exact">exact</span> : <span className="adm-tag">closest</span>}{' '}
                {votes.has(r.tripId) && voteIcon(votes.get(r.tripId))}
              </li>
            ))}
          </ol>
        ) : (
          <p className="adm-muted">No results.</p>
        )}
      </div>

      <div className="adm-json">
        <div>
          <h4>State in</h4>
          <pre>{JSON.stringify(log.stateIn, null, 2)}</pre>
        </div>
        <div>
          <h4>State out</h4>
          <pre>{JSON.stringify(log.stateOut, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
