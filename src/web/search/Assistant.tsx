import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EXAMPLES, type Example } from '../../shared/examples.ts';
import type { ChatTurn, FaqAnswer, SearchResponse } from '../../shared/types.ts';

export interface Message extends ChatTurn {
  answer?: FaqAnswer | null;
  interpreter?: SearchResponse['interpreter'];
  error?: boolean;
}

interface Props {
  messages: Message[];
  thinking: boolean;
  onSend: (text: string) => void;
  onStartOver: () => void;
  onExample: (example: Example) => void;
}

export function Assistant({ messages, thinking, onSend, onStartOver, onExample }: Props) {
  const [open, setOpen] = useState(false); // only used on mobile, where the panel is a bottom sheet
  const log = useRef<HTMLDivElement>(null);
  const examples = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
    const text = input.value.trim();
    if (!text || thinking) return;
    input.value = '';
    onSend(text);
  }

  function play(example: Example) {
    examples.current!.open = false; // make room for the conversation
    onExample(example);
  }

  return (
    <aside className={`assistant${open ? ' is-open' : ''}`}>
      <button type="button" className="assistant__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="assistant__title">✨ Trip assistant</span>
        <span className="assistant__subtitle">Refine your search in your own words</span>
        <span className="assistant__toggle" aria-hidden>
          {open ? '▾' : '▴'}
        </span>
      </button>

      <div className="assistant__body">
        <details className="examples" ref={examples}>
          <summary>Try an example</summary>
          <ul>
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button type="button" onClick={() => play(ex)}>
                  <strong>{ex.label}</strong>
                  <small>{ex.shows}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>

        <div className="assistant__log" ref={log}>
          {messages.length === 0 && (
            <p className="muted small">
              I start from your current search. Tell me what to change (dates, budget, vibe, who you travel with) or ask anything about
              travelling with WeRoad.
            </p>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} message={m} />
          ))}
          {thinking && <div className="bubble bubble--assistant is-thinking">Thinking…</div>}
        </div>

        <form className="assistant__form" onSubmit={submit}>
          <input name="message" placeholder="e.g. only trips with a cooking class" autoComplete="off" maxLength={500} />
          <button className="btn btn--ai" disabled={thinking}>
            Send
          </button>
        </form>
        <div className="assistant__foot">
          <button type="button" className="link" onClick={onStartOver}>
            Start over
          </button>
        </div>
      </div>
    </aside>
  );
}

function Bubble({ message: m }: { message: Message }) {
  return (
    <div className={`bubble bubble--${m.role}${m.error ? ' bubble--error' : ''}`}>
      <p>{m.text}</p>
      {m.answer && (
        <div className="faq-answer">
          <span className="faq-answer__label">From our FAQ</span>
          <p>{m.answer.text}</p>
          <ul>
            {m.answer.faqs.map((f) => (
              <li key={f.id}>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.title}
                  </a>
                ) : (
                  f.title
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.interpreter === 'rules' && <small className="bubble__note">Rule-based fallback: the AI was unavailable</small>}
    </div>
  );
}
