import { useEffect, useState, type ReactNode } from 'react';
import { BOOKABLE_STATUSES, type CatalogMeta, type Tour } from '../../shared/types.ts';

// Small helpers shared by the admin tabs.

export interface TabProps {
  meta: CatalogMeta;
  selected: string | null; // id from the hash (#trips/12), or "new"
  select: (id: string | number | null) => void;
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const today = () => new Date().toISOString().slice(0, 10);
// Same rule as the server: anything else is never shown to visitors.
export const isBookable = (t: Tour) => BOOKABLE_STATUSES.includes(t.salesStatus) && t.seatsLeft > 0 && t.startingDate > today();

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
