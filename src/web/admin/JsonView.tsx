import { useState } from 'react';

// A small coloured JSON tree with collapsible arrays and objects, for the backoffice "See raw document".
// No dependency: documents here are a few hundred lines at most.

export type Expand = 'auto' | 'all' | 'none';

/** In "auto", long arrays (departures, itinerary, embedding preview) start collapsed. */
const AUTO_COLLAPSE_OVER = 5;

export function JsonView({ value, expand }: { value: unknown; expand: Expand }) {
  return (
    <div className="json">
      <Node value={value} expand={expand} depth={0} last />
    </div>
  );
}

function Node({ name, value, expand, depth, last }: { name?: string; value: unknown; expand: Expand; depth: number; last: boolean }) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  const entries = isObject ? Object.entries(value as object) : [];
  const startOpen = depth === 0 || expand === 'all' || (expand === 'auto' && (!isArray || entries.length <= AUTO_COLLAPSE_OVER));
  const [open, setOpen] = useState(startOpen);
  // Object entries show their key; array items don't.
  const key = name !== undefined && (
    <>
      <span className="json__key">"{name}"</span>
      <span className="json__punct">: </span>
    </>
  );
  const comma = last ? '' : ',';

  if (!isObject)
    return (
      <div className="json__line" style={{ paddingLeft: depth * 16 }}>
        {key}
        <Scalar value={value} />
        <span className="json__punct">{comma}</span>
      </div>
    );

  const [l, r] = isArray ? ['[', ']'] : ['{', '}'];
  const summary = isArray ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} key${entries.length === 1 ? '' : 's'}`;
  if (!entries.length)
    return (
      <div className="json__line" style={{ paddingLeft: depth * 16 }}>
        {key}
        <span className="json__punct">
          {l}
          {r}
          {comma}
        </span>
      </div>
    );

  return (
    <>
      <div className="json__line" style={{ paddingLeft: depth * 16 }}>
        <button type="button" className="json__toggle" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        {key}
        <span className="json__punct">{l}</span>
        {!open && (
          <>
            <button type="button" className="json__summary" onClick={() => setOpen(true)}>
              {summary}
            </button>
            <span className="json__punct">
              {r}
              {comma}
            </span>
          </>
        )}
      </div>
      {open && (
        <>
          {entries.map(([k, v], i) => (
            // In "all"/"none" modes the parent remounts the tree (see RawDocument), so children re-read `expand`.
            <Node key={k} name={isArray ? undefined : k} value={v} expand={expand} depth={depth + 1} last={i === entries.length - 1} />
          ))}
          <div className="json__line" style={{ paddingLeft: depth * 16 }}>
            <span className="json__punct">
              {r}
              {comma}
            </span>
          </div>
        </>
      )}
    </>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="json__string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json__number">{value}</span>;
  if (typeof value === 'boolean') return <span className="json__bool">{String(value)}</span>;
  return <span className="json__null">null</span>;
}
