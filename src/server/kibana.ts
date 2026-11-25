import { config } from './config.ts';
import { INDEX } from './es.ts';

/** Kibana Discover link for the search log, shown in /admin. */
export const kibanaDiscoverUrl = () =>
  config.kibanaUrl ? `${config.kibanaUrl.replace(/\/$/, '')}/app/discover#/?_a=(dataSource:(dataViewId:${INDEX.searches},type:dataView))&_g=(time:(from:now-7d,to:now))` : null;

/** Creates the "Search log" data view so Kibana is usable out of the box. Best effort: Kibana boots slowly. */
export async function provisionKibana(attempts = 30) {
  if (!config.kibanaInternalUrl) return;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${config.kibanaInternalUrl}/api/data_views/data_view`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'kbn-xsrf': 'true' },
        body: JSON.stringify({ override: true, data_view: { id: INDEX.searches, name: 'Search log', title: INDEX.searches, timeFieldName: 'at' } }),
      });
      if (res.ok) return console.log('Kibana data view ready');
    } catch {
      // Kibana not up yet
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.warn('Kibana data view not created (Kibana unreachable)');
}
