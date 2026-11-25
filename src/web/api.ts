import type {
  CatalogMeta,
  ClickRequest,
  Faq,
  FeedbackRequest,
  Page,
  SearchLog,
  SearchLogQuery,
  SearchRequest,
  SearchResponse,
  SearchStats,
  Settings,
  SettingsView,
  Trip,
} from '../shared/types.ts';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data.error ?? `${res.status} ${res.statusText}`;
    // Validation errors carry zod issues: name the field, or the admin can't tell what to fix.
    const issues = Array.isArray(data.details) ? (data.details as Issue[]).map((i) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message)) : [];
    throw new Error(issues.length ? `${error}: ${issues.join('; ')}` : error);
  }
  return data as T;
}

type Issue = { path?: (string | number)[]; message: string };

const qs = (params: object) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

export const api = {
  meta: () => call<CatalogMeta>('GET', '/meta'),
  search: (req: SearchRequest) => call<SearchResponse>('POST', '/search', req),
  feedback: (searchId: string, fb: FeedbackRequest) => call<{ ok: true }>('POST', `/searches/${searchId}/feedback`, fb),
  click: (searchId: string, click: ClickRequest) => call<{ ok: true }>('POST', `/searches/${searchId}/click`, click),

  admin: {
    trips: (q?: string) => call<Trip[]>('GET', `/admin/trips${qs({ q })}`),
    trip: (id: number) => call<Trip & { faqs: Faq[] }>('GET', `/admin/trips/${id}`),
    rawTrip: (id: number) => call<Record<string, unknown>>('GET', `/admin/trips/${id}/raw`),
    createTrip: (trip: Omit<Trip, 'id'>) => call<Trip>('POST', '/admin/trips', trip),
    updateTrip: (trip: Trip) => call<Trip>('PUT', `/admin/trips/${trip.id}`, trip),
    deleteTrip: (id: number) => call<{ ok: true }>('DELETE', `/admin/trips/${id}`),

    rawFaq: (id: number) => call<Record<string, unknown>>('GET', `/admin/faqs/${id}/raw`),
    faqs: (destination?: string) => call<Faq[]>('GET', `/admin/faqs${qs({ destination })}`),
    createFaq: (faq: Omit<Faq, 'id'>) => call<Faq>('POST', '/admin/faqs', faq),
    updateFaq: (faq: Faq) => call<Faq>('PUT', `/admin/faqs/${faq.id}`, faq),
    deleteFaq: (id: number) => call<{ ok: true }>('DELETE', `/admin/faqs/${id}`),

    searches: (query: SearchLogQuery) => call<Page<SearchLog>>('GET', `/admin/searches${qs(query)}`),
    stats: () => call<SearchStats>('GET', '/admin/searches/stats'),
    reset: () => call<{ ok: true }>('POST', '/admin/reset'),
    settings: () => call<SettingsView>('GET', '/admin/settings'),
    saveSettings: (settings: Settings) => call<SettingsView>('PUT', '/admin/settings', settings),
  },
};
