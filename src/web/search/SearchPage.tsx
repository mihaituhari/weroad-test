import { useEffect, useRef, useState } from 'react';
import type { Example } from '../../shared/examples.ts';
import type { CatalogMeta, SearchResponse, SearchState } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Assistant, type Message } from './Assistant.tsx';
import { Chips, FilterBar, SearchBar, type BarEdits } from './Filters.tsx';
import { patch } from './format.ts';
import { Results } from './Results.tsx';
import './search.css';

function getSessionId() {
  let id = sessionStorage.getItem('weroad.sessionId');
  if (!id) sessionStorage.setItem('weroad.sessionId', (id = crypto.randomUUID()));
  return id;
}

export function SearchPage() {
  const [sessionId] = useState(getSessionId);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [state, setState] = useState<SearchState>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [edits, setEditsState] = useState<BarEdits>({});
  const [busy, setBusy] = useState<'search' | 'assistant' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Refs, not state: examples chain several turns in one handler and must see each turn's result immediately.
  const chat = useRef<Message[]>([]);
  const barEdits = useRef<BarEdits>({});
  const asking = useRef<Message | null>(null); // user bubble of the assistant turn in flight
  const latest = useRef(0);

  const setChat = (next: Message[]) => setMessages((chat.current = next));
  const setEdits = (next: BarEdits) => setEditsState((barEdits.current = next));

  /** One search turn: classic without `message`, assistant with it. Resolves to null if a newer search superseded it. */
  async function run(base: SearchState, message?: string): Promise<SearchResponse | null> {
    const id = ++latest.current;
    // Whatever is typed in the search bar is part of every search, submitted or not, so the inputs always show what was searched.
    const { text, ...dates } = barEdits.current;
    const next = patch(base, text === undefined ? dates : { ...dates, text: text.trim() });
    setEdits({});
    // A superseded assistant turn still gets an answer, so the chat (and the history sent to the LLM) stays paired.
    if (asking.current && chat.current.includes(asking.current)) setChat([...chat.current, { role: 'assistant', text: 'Interrupted: your search changed.' }]);
    asking.current = message ? { role: 'user', text: message } : null;
    const history = chat.current.filter((m) => !m.error).slice(-6).map(({ role, text }) => ({ role, text }));
    if (asking.current) setChat([...chat.current, asking.current]);
    setState(next);
    setBusy(message ? 'assistant' : 'search');
    setError(null);
    try {
      const res = await api.search({ sessionId, state: next, message, history: message ? history : undefined });
      if (id !== latest.current) return null;
      setResponse(res);
      setState(res.state);
      if (message) setChat([...chat.current, { role: 'assistant', text: res.reply ?? 'I updated your search.', answer: res.answer, interpreter: res.interpreter }]);
      return res;
    } catch (e) {
      if (id !== latest.current) return null;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (message) setChat([...chat.current, { role: 'assistant', text: `Sorry, I couldn't process that (${msg}).`, error: true }]);
      return null;
    } finally {
      if (id === latest.current) {
        asking.current = null;
        setBusy(null);
      }
    }
  }

  function startOver() {
    setChat([]);
    setEdits({});
    run({});
  }

  /** Replays a demo script turn by turn, so the visitor watches the conversation unfold. */
  async function playExample(example: Example) {
    setChat([]);
    setEdits({});
    let res = await run(example.start);
    for (const turn of example.turns) {
      if (!res) return; // failed, or the visitor started another search meanwhile
      res = await run(res.state, turn);
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev: log one search, not two
    started.current = true;
    api.meta().then(setMeta, (e: Error) => setError(e.message));
    run({});
  }, []);

  // While the assistant is thinking, a classic search would supersede its turn and drop the constraints it is adding.
  const locked = busy === 'assistant';

  return (
    <main className="container search-page">
      <h1 className="page-title">Find your next trip</h1>
      <fieldset className="classic" disabled={locked}>
        <SearchBar state={state} edits={edits} onEdit={(e) => setEdits({ ...barEdits.current, ...e })} onSearch={() => run(state)} />
        <FilterBar state={state} meta={meta} onChange={run} />
        <Chips state={state} onChange={run} />
      </fieldset>
      <div className="search-layout">
        <Results
          response={response}
          busy={busy !== null}
          locked={locked}
          error={error}
          sort={state.sort}
          onSort={(sort) => run(patch(state, { sort: sort === 'relevance' ? undefined : sort }))}
          onRetry={() => run(state)}
          onRefine={(changes) => run(patch(state, changes))}
        />
        <Assistant messages={messages} thinking={locked} onSend={(text) => run(state, text)} onStartOver={startOver} onExample={playExample} />
      </div>
    </main>
  );
}
