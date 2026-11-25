export const meta = {
  name: 'weroad-review',
  description: 'Five-lens code review of the WeRoad trip assistant, each lens followed by an adversarial verifier',
  phases: [
    { title: 'Review', detail: '5 independent reviewers' },
    { title: 'Verify', detail: 'one skeptic per lens tries to refute each finding' },
  ],
}

const ROOT = '<repo>'
const COMMON = `
Project: ${ROOT}, a WeRoad (small-group travel) search assistant for a hiring test. Read ${ROOT}/AGENTS.md first (architecture, non-negotiables, API), then ${ROOT}/REQUIREMENTS.md.
The API is running at http://localhost:3000 (Elasticsearch at :9200, already seeded). You may call it with curl. Classic searches (POST /api/search without "message") are free; assistant turns (with "message") call Claude and cost money: at most 4 assistant calls in total. Do not call POST /api/admin/reset or DELETE endpoints. Do NOT edit any file: review only.
Report only real, concrete problems. Each finding needs: file + line, a concrete failing scenario (inputs → wrong output), severity (high = breaks a requirement/non-negotiable or crashes; medium = wrong behaviour a user/reviewer would notice; low = minor), and a suggested fix (1-2 sentences). No style nits unless the lens is simplicity. Max 8 findings, most severe first. If you find nothing real, return an empty list.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'file', 'line', 'severity', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          real: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['title', 'real', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}

const LENSES = [
  { key: 'pipeline', prompt: `Lens: correctness of the search pipeline in ${ROOT}/src/server/search/*.ts (run, retrieve, match, confidence, interpret, rules, faq, suggest, state) and src/server/routes/*.ts, catalog.ts, seed.ts. Look for logic bugs: wrong date math (timezones, month ends, year rollover), penalties/exactness inconsistencies, ranking bugs, cases where a non-bookable departure could be returned, crashes on edge inputs (empty arrays, missing rating, trips with no tours, Math.min of empty), state normalisation bugs, ES query mistakes (nested filters, named queries, size limits).` },
  { key: 'requirements', prompt: `Lens: requirements and honesty, tested against the live API. Exercise: a classic search; multi-turn refinement (send state + message + history like the SPA in src/web/search/SearchPage.tsx does); zero-result requests (e.g. budget 100, women only); a tight date window; feedback (POST /api/searches/:id/feedback) and click (POST /api/searches/:id/click) then GET /api/admin/searches and /api/admin/searches/stats to confirm they are stored and filterable; FAQ relationship (GET /api/admin/trips/:id returns faqs). Verify: sold-out/non-bookable departures never appear (check salesStatus, seatsLeft, dates in every result), confidence and reasons are honest (a ✓ never overclaims, low confidence when nothing matches), the response always has results (no dead end). Report gaps against REQUIREMENTS.md and AGENTS.md.` },
  { key: 'frontend', prompt: `Lens: the SPA in ${ROOT}/src/web (search page under src/web/search, admin under src/web/admin, api.ts, main.tsx). Look for state-sync bugs (filters vs chips vs assistant-returned state), race conditions between overlapping searches, example playback bugs, feedback/click wiring (searchId), admin CRUD bugs (create/edit/delete trip and FAQ, validation errors shown, data loss on edit such as fields dropped), pagination/filters of the search log, accessibility blockers. You can read code; the dev server for the SPA may be at http://localhost:5174 (Vite, proxies /api).` },
  { key: 'security', prompt: `Lens: security and operations for a public demo (no auth by design, to be deployed on Railway). Look at input validation (zod schemas), request size limits, ES query construction from user input, prompt-injection paths (visitor message, history, FAQ bodies edited via admin), LLM cost abuse (daily budget breaker in interpret.ts), PII handling (redact in state.ts), error handling leaking internals, Dockerfile/docker-compose issues (secrets, ports, healthchecks, image), boot robustness (ES not ready, Kibana down), data loss on reset/reseed. Distinguish clearly "by design for the demo" (no auth) from real bugs; still report the top risks of the no-auth design concisely as one finding.` },
  { key: 'simplicity', prompt: `Lens: code quality for a human maintainer (the brief: "efficiency, not verbosity; easily understood, maintained and modified by a human"). Review all of ${ROOT}/src and ${ROOT}/eval. Find: duplicated logic that should be shared (e.g. the bookable rule duplicated in the admin UI), dead code/unused exports, over-long functions that hide logic, misleading names or comments, inconsistencies between AGENTS.md and the code, files where a reviewer would get lost. Only actionable items with a concrete suggested change; severity low/medium.` },
]

const results = await pipeline(
  LENSES,
  (l) => agent(`${COMMON}\n\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (review, l) => {
    const findings = (review && review.findings) || []
    if (!findings.length) return { lens: l.key, findings: [], verdicts: [] }
    return agent(
      `You are a skeptical senior engineer. Another reviewer reported the findings below about ${ROOT} (read ${ROOT}/AGENTS.md first). For EACH finding, try hard to refute it: open the cited file/line, trace the code, and if useful reproduce it against the running API at http://localhost:3000 (classic searches only, no assistant messages, no reset/delete). Mark real=false if the scenario cannot happen, is already handled elsewhere, is intended by design and documented, or is purely stylistic. Mark real=true only with concrete evidence. Do not edit files.\n\nFindings:\n${JSON.stringify(findings, null, 2)}`,
      { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICTS },
    ).then((v) => ({ lens: l.key, findings, verdicts: (v && v.verdicts) || [] }))
  },
)

const confirmed = []
for (const r of results.filter(Boolean)) {
  for (const f of r.findings) {
    const v = r.verdicts.find((x) => x.title === f.title)
    if (!v || v.real) confirmed.push({ lens: r.lens, ...f, evidence: v ? v.evidence : 'unverified' })
  }
}
const rejected = results.filter(Boolean).flatMap((r) => r.verdicts.filter((v) => !v.real).map((v) => ({ lens: r.lens, title: v.title, why: v.evidence })))
log(`${confirmed.length} confirmed, ${rejected.length} rejected`)
return { confirmed, rejected }
