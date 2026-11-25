import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import type { CatalogMeta } from '../../shared/types.ts';
import { JsonView, type Expand } from './JsonView.tsx';

// Small helpers shared by the admin tabs.

export interface TabProps {
  meta: CatalogMeta;
  selected: string | null; // id from the hash (#trips/12), or "new"
  select: (id: string | number | null) => void;
  reloadMeta: () => void; // after trip writes: the vocabulary (destinations, travel types…) comes from the trips
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Whole-row click for mouse users. Keyboard users get a link or button in the row, which handles its own clicks (and Cmd+click). */
export const rowClick = (open: () => void) => (e: MouseEvent) => {
  if (!(e.target as Element).closest('a, button')) open();
};

/** Fetches on mount and when `deps` change; keeps the previous data while reloading and drops stale responses. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], debounceMs = 0) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        load().then(
          (data) => live && setState({ data, error: null }),
          (err: Error) => live && setState((s) => ({ ...s, error: err.message })),
        ),
      debounceMs,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

/** Runs a write, tracks busy/error, calls `onDone` on success. */
export function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={wide ? 'adm-field adm-field--wide' : 'adm-field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export const Alert = ({ error }: { error: string | null }) => (error ? <p className="adm-alert">{error}</p> : null);

/**
 * Explanatory tooltip, shown at once on hover and on keyboard focus (native `title` is slow and easy to miss).
 * Fixed-positioned from the trigger's box so `.adm-scroll` can't clip it; anchored right in the right half of the screen.
 */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const show = (e: SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(r.left > innerWidth / 2 ? { top: r.bottom + 6, right: innerWidth - r.right } : { top: r.bottom + 6, left: r.left });
  };
  const hide = () => setPos(null);
  return (
    <span
      className="adm-tip"
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {children}
      <span role="tooltip" id={id} className={pos ? 'adm-tip__box is-open' : 'adm-tip__box'} style={pos ?? undefined}>
        {text}
      </span>
    </span>
  );
}

/**
 * "See raw document": loads the record as stored when opened (`load`) and shows it in a native modal
 * dialog as a coloured, collapsible JSON tree.
 */
export function RawDocument({ load, title, note }: { load: () => Promise<unknown>; title: string; note: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [doc, setDoc] = useState<{ value: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expand, setExpand] = useState<{ mode: Expand; n: number }>({ mode: 'auto', n: 0 });
  const [copied, setCopied] = useState(false);

  const open = () => {
    setDoc(null);
    setError(null);
    setCopied(false);
    setExpand({ mode: 'auto', n: 0 });
    dialog.current?.showModal();
    load().then((value) => setDoc({ value }), (e: Error) => setError(e.message));
  };
  // Expand/collapse all: remount the tree so every node re-reads its default.
  const all = (mode: Expand) => setExpand((x) => ({ mode, n: x.n + 1 }));
  const copy = () =>
    doc && navigator.clipboard.writeText(JSON.stringify(doc.value, null, 2)).then(() => setCopied(true), () => setCopied(false));

  return (
    <>
      <button type="button" className="adm-link" onClick={open}>
        See raw document
      </button>
      {/* A click on the backdrop (the dialog element itself, outside its content) closes it. */}
      <dialog ref={dialog} className="adm-dialog" aria-label={title} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="adm-dialog__head">
          <h3>{title}</h3>
          <span className="adm-muted">{note}</span>
          <div className="adm-actions">
            <button type="button" className="adm-btn" onClick={() => all('all')} disabled={!doc}>
              Expand all
            </button>
            <button type="button" className="adm-btn" onClick={() => all('none')} disabled={!doc}>
              Collapse all
            </button>
            <button type="button" className="adm-btn" onClick={copy} disabled={!doc}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button type="button" className="adm-btn" onClick={() => dialog.current?.close()} autoFocus>
              Close
            </button>
          </div>
        </div>
        <div className="adm-dialog__body">
          <Alert error={error} />
          {doc ? <JsonView key={expand.n} value={doc.value} expand={expand.mode} /> : !error && <p className="adm-muted">Loading…</p>}
        </div>
      </dialog>
    </>
  );
}
