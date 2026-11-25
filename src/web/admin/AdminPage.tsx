import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Alert, useAction, useLoad } from './ui.tsx';
import { SearchesTab } from './SearchesTab.tsx';
import { TripsTab } from './TripsTab.tsx';
import { FaqsTab } from './FaqsTab.tsx';
import { SettingsTab } from './SettingsTab.tsx';
import './admin.css';

const TABS = { searches: 'Searches', trips: 'Trips', faqs: 'FAQs', settings: 'Settings' };
type Tab = keyof typeof TABS;

// The hash holds the tab and the open record (#trips/12, #faqs/new), so links and the back button just work.
function readHash() {
  const [tab, id] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { tab: (Object.hasOwn(TABS, tab) ? tab : 'searches') as Tab, id: id || null };
}

export function AdminPage() {
  const [route, setRoute] = useState(readHash);
  const [version, setVersion] = useState(0); // bumped by a reset: reloads meta and remounts the tabs
  const meta = useLoad(api.meta, [version]);
  const reset = useAction(() => setVersion((v) => v + 1));

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const { tab, id } = route;
    const record = id === null ? null : id === 'new' ? (tab === 'trips' ? 'New trip' : 'New FAQ') : `${tab === 'trips' ? 'Trip' : 'FAQ'} #${id}`;
    document.title = [record, TABS[tab], 'Backoffice', 'WeRoad'].filter(Boolean).join(' · ');
  }, [route]);

  const select = (id: string | number | null) => {
    location.hash = id === null ? route.tab : `${route.tab}/${id}`;
  };

  const onReset = () => {
    if (confirm('Reload all trips and FAQs from samples/? Your edits will be lost. The search log is kept.')) reset.run(api.admin.reset);
  };

  return (
    <main className="container container--wide adm">
      <div className="adm-head">
        <h1>Backoffice</h1>
        <div className="adm-actions">
          {meta.data?.kibanaUrl && (
            <a className="adm-btn" href={meta.data.kibanaUrl} target="_blank" rel="noreferrer">
              Open Kibana ↗
            </a>
          )}
          <button className="adm-btn" onClick={onReset} disabled={reset.busy}>
            {reset.busy ? 'Resetting…' : 'Reset demo data'}
          </button>
        </div>
      </div>
      <Alert error={reset.error} />

      <nav className="adm-tabs">
        {Object.entries(TABS).map(([key, label]) => (
          <a key={key} href={`#${key}`} className={key === route.tab ? 'active' : ''}>
            {label}
          </a>
        ))}
      </nav>

      <Alert error={meta.error && `Could not load the catalog: ${meta.error}`} />
      {meta.data && (
        <div key={version}>
          {route.tab === 'searches' && <SearchesTab />}
          {route.tab === 'trips' && <TripsTab meta={meta.data} selected={route.id} select={select} reloadMeta={meta.reload} />}
          {route.tab === 'settings' && <SettingsTab />}
          {route.tab === 'faqs' && <FaqsTab meta={meta.data} selected={route.id} select={select} reloadMeta={meta.reload} />}
        </div>
      )}
    </main>
  );
}
