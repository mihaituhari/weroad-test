import { useState, type FormEvent } from 'react';
import type { FeedbackRequest, SearchResponse, SearchState, Suggestion } from '../../shared/types.ts';
import { api } from '../api.ts';
import { INTERPRETER_LABEL, pct } from './format.ts';
import { ResultCard, Votes } from './ResultCard.tsx';

type Sort = NonNullable<SearchState['sort']>;

interface Props {
  response: SearchResponse | null;
  busy: boolean;
  error: string | null;
  sort?: Sort;
  onSort: (sort: Sort) => void;
  onRetry: () => void;
  onRefine: (patch: SearchState) => void;
}

export function Results({ response, busy, error, sort = 'relevance', onSort, onRetry, onRefine }: Props) {
  return (
    <section className={`results${busy ? ' is-busy' : ''}`} aria-busy={busy}>
      <div className="results__head">
        <h2>{response ? heading(response) : 'Searching…'}</h2>
        <label className="sort">
          Sort by
          <select value={sort} onChange={(e) => onSort(e.target.value as Sort)}>
            <option value="relevance">Best match</option>
            <option value="price">Price</option>
            <option value="date">Soonest</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="notice notice--error">
          Something went wrong: {error}.{' '}
          <button type="button" className="link" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {response ? <Found response={response} onRefine={onRefine} /> : !error && <Skeleton />}
    </section>
  );
}

// exactCount counts every exact trip in the catalog; results is only the top of the list.
function heading({ results, exactCount }: SearchResponse) {
  const closest = results.filter((r) => !r.exact).length;
  const match = exactCount === 1 ? '1 trip matches' : `${exactCount} trips match`;
  if (!closest) return `${match} your search${exactCount > results.length ? ` · top ${results.length} shown` : ''}`;
  if (!exactCount) return `No exact match · ${closest} closest options`;
  return `${match} + ${closest} closest options`;
}

function Found({ response, onRefine }: { response: SearchResponse; onRefine: (patch: SearchState) => void }) {
  const { searchId, confidence: c, relaxed, unmatched, results, interpreter, exactCount, suggestions } = response;
  return (
    <>
      <div className={`banner banner--${c.level}`}>
        <p>
          <strong>{pct(c.score)} confident</strong> · {c.explanation}
        </p>
        <details>
          <summary>How we scored this</summary>
          <ul>
            <li>
              <strong>{pct(c.understanding)}</strong> understanding: how sure we are that we read your request right
            </li>
            <li>
              <strong>{pct(c.matchQuality)}</strong> match quality: how well the top trips fit it
            </li>
            <li>Interpreted by: {INTERPRETER_LABEL[interpreter]}</li>
          </ul>
        </details>
      </div>

      {relaxed.length > 0 && (
        <div className="notice notice--warning">
          {exactCount ? `Only ${exactCount} matching everything, so we added close options` : 'No trip matches everything. Closest options below'} — we loosened:
          <ul>
            {relaxed.map((r) => (
              <li key={r.note}>{r.note}</li>
            ))}
          </ul>
        </div>
      )}
      {unmatched.length > 0 && <div className="notice">We couldn't find trips for: {unmatched.join(', ')}.</div>}

      {suggestions.length > 0 && <Narrow suggestions={suggestions} onRefine={onRefine} />}

      {results.length ? (
        <div className="grid">
          {results.map((r, i) => (
            <ResultCard key={`${searchId}:${r.trip.id}`} result={r} searchId={searchId} position={i + 1} />
          ))}
        </div>
      ) : (
        <p className="notice">No bookable departures right now. Try removing a filter.</p>
      )}

      <SearchFeedback key={searchId} searchId={searchId} />
    </>
  );
}

/** For visitors who don't know what they want yet: one click narrows a broad search. */
function Narrow({ suggestions, onRefine }: { suggestions: Suggestion[]; onRefine: (patch: SearchState) => void }) {
  const facets = Map.groupBy(suggestions, (s) => s.facet);
  return (
    <div className="narrow">
      <strong>Not sure yet? Narrow it down</strong>
      {[...facets].map(([facet, items]) => (
        <div key={facet} className="narrow__row">
          <span className="muted">{facet}</span>
          {items.map((s) => (
            <button key={s.label} type="button" className="chip chip--suggest" onClick={() => onRefine(s.patch)}>
              {s.label} <span className="muted">· {s.count}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function SearchFeedback({ searchId }: { searchId: string }) {
  const [vote, setVote] = useState<FeedbackRequest['vote'] | null>(null);
  const [sent, setSent] = useState(false);

  function cast(v: FeedbackRequest['vote']) {
    setVote(v);
    api.feedback(searchId, { vote: v }).catch(() => setVote(null));
  }
  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const comment = String(new FormData(e.currentTarget).get('comment') ?? '').trim();
    if (vote && comment) api.feedback(searchId, { vote, comment }).catch(() => {});
    setSent(true);
  }

  if (sent) return <p className="feedback">Thanks — this helps us improve</p>;
  return (
    <div className="feedback">
      <span>Were these results useful?</span>
      <Votes vote={vote} onVote={cast} />
      {vote && (
        <form onSubmit={send}>
          <textarea name="comment" rows={2} maxLength={1000} placeholder="Anything we should know? (optional)" />
          <button className="btn btn--sm">Send</button>
        </form>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="card skeleton">
          <div className="card__tile" />
          <div className="skeleton__line" />
          <div className="skeleton__line skeleton__line--short" />
        </div>
      ))}
    </div>
  );
}
