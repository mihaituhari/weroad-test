import { useState } from 'react';
import type { FeedbackRequest, TripResult } from '../../shared/types.ts';
import { api } from '../api.ts';
import { day, levelOf, money, pct, STATUS_LABEL, tileClass } from './format.ts';

type Vote = FeedbackRequest['vote'];

export function ResultCard({ result, searchId, position }: { result: TripResult; searchId: string; position: number }) {
  const { trip, departures, fromPrice, exact, confidence, reasons, goodToKnow } = result;
  const [vote, setVote] = useState<Vote | null>(null);
  // Opening a trip is the signal we measure impact with (CTR, rescued zero-result searches).
  const track = () => void api.click(searchId, { tripId: trip.id, position }).catch(() => {});
  // The strikethrough price must belong to the departure that sets "From", or the discount would lie.
  const cheapest = departures.find((d) => d.priceEur === fromPrice);
  const basePrice = cheapest?.basePriceEur && cheapest.basePriceEur > fromPrice ? cheapest.basePriceEur : null;

  function onVote(v: Vote) {
    setVote(v);
    api.feedback(searchId, { vote: v, tripId: trip.id }).catch(() => setVote(null));
  }

  return (
    <article className="card">
      <a className={`card__tile ${tileClass(trip.continent)}`} href={trip.url} target="_blank" rel="noreferrer" tabIndex={-1} onClick={track}>
        <span className="card__badges">
          <span className={`badge badge--${levelOf(confidence)}`}>{pct(confidence)} match</span>
          {!exact && <span className="badge">Closest option</span>}
        </span>
        <span className="card__dest">{trip.destinationLabel}</span>
        <span className="card__overlay">
          <span>{trip.numberOfDays} days</span>
          <span>{trip.rating ? `★ ${trip.rating.value.toFixed(1)}` : 'New'}</span>
        </span>
      </a>

      <h3 className="card__title">
        <a href={trip.url} target="_blank" rel="noreferrer" onClick={track}>
          {trip.title}
        </a>
      </h3>
      <p className="price">
        <span className="muted">From</span>
        <strong>{money(fromPrice)}</strong>
        {basePrice && (
          <>
            <s className="muted">{money(basePrice)}</s>
            <span className="discount">-{Math.round((1 - fromPrice / basePrice) * 100)}%</span>
          </>
        )}
      </p>

      <ul className="departures">
        {departures.slice(0, 3).map((d) => (
          <li key={d.id}>
            {day(d.startingDate)} – {day(d.endingDate)} · {money(d.priceEur)} ·{' '}
            <span className={`status status--${d.salesStatus.toLowerCase()}`}>{STATUS_LABEL[d.salesStatus] ?? d.salesStatus}</span> ·{' '}
            {d.seatsLeft} {d.seatsLeft === 1 ? 'seat' : 'seats'} left
          </li>
        ))}
      </ul>

      <ul className="reasons">
        {reasons.map((r) => (
          <li key={r.text} className={r.ok ? 'is-ok' : 'is-ko'}>
            {r.text}
          </li>
        ))}
      </ul>

      {goodToKnow && (
        <p className="good-to-know">
          Good to know:{' '}
          {goodToKnow.url ? (
            <a href={goodToKnow.url} target="_blank" rel="noreferrer">
              {goodToKnow.title}
            </a>
          ) : (
            goodToKnow.title
          )}
        </p>
      )}

      <div className="card__feedback">
        <span>Good suggestion?</span>
        <Votes vote={vote} onVote={onVote} />
      </div>
    </article>
  );
}

export function Votes({ vote, onVote }: { vote: Vote | null; onVote: (v: Vote) => void }) {
  return (
    <span className="votes">
      <button type="button" className="vote" aria-pressed={vote === 'up'} aria-label="Yes" onClick={() => onVote('up')}>
        👍
      </button>
      <button type="button" className="vote" aria-pressed={vote === 'down'} aria-label="No" onClick={() => onVote('down')}>
        👎
      </button>
    </span>
  );
}
