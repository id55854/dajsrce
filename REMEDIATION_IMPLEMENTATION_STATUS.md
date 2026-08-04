# DajSrce audit remediation status

**Implementation date:** 2026-08-04

**Baseline:** `PROJECT_WIDE_AUDIT_AND_OPTIMIZATION_PLAN.md`
**Current architecture/runbook:** `TECHNICAL_IMPLEMENTATION.md`

## Release verdict

The repository-actionable release blockers and primary scalability defects are remediated in the current worktree. All fifteen new migrations and the complete official association snapshot have been applied to the production Supabase project before application deployment. A restored-staging rehearsal, off-site backup evidence, external schedulers, provider credentials, alert destinations and legal/privacy/accounting review remain explicit owner controls.

The old schema/client combination is intentionally incompatible with the new security posture: broad direct table privileges were removed. Roll forward with the complete migration/application set.

## Measured outcome

| Measure | Audit baseline | Remediated result |
|---|---:|---:|
| Public location response | 1,000 broad rows, ~2.53 MB | <= 150 features by default, representative max 58,321 bytes |
| Map first-load JS | ~285 kB | ~136 kB |
| Needs first-load JS | ~358 kB | ~205 kB |
| Institution detail first-load JS | ~357 kB | ~205 kB |
| Default map DOM | ~18,678 elements / 1,029 buttons | 267 elements / 37 buttons in smoke state |
| Public map objects | ~1,000 markers plus cards | <= 200 features, <= 60 result rows |
| Dependency audit | 7 known production advisories | 0 known npm advisories at implementation time |
| Map incremental raw bundle | no enforced budget | 269,176 bytes; CI budget 327,680 bytes |
| Automated repository tests | no reliable gate | 93 tests across 17 files |
| Official association directory | 43,748 active-only legacy rows | 71,057 official rows across all 3 statuses |
| Directory public read | no complete public directory | 513 ms first page; 2,255 ms final page; 202 ms detail in production smoke |

## Finding disposition

### Security and privacy

| Finding | Disposition |
|---|---|
| SEC-01 | Seed HTTP mutation permanently returns 404; service/local CLI is the replacement. |
| SEC-02 | Profile role/institution writes are revoked; controlled setup RPC validates allowed transitions. |
| SEC-03 | Company creation/membership is transactional and service-only; arbitrary direct membership writes are revoked. |
| SEC-04 | Tenant subscription/verification/ownership fields cannot be forged by authenticated table updates. |
| SEC-05 | Base institution and registry tables are not publicly selectable; public DTOs expose stable coarse coordinates only. |
| SEC-06 | Verification is POST-only, hashed, expiring, single-use and requires authoritative registry plus published-email/DNS control. |
| SEC-07 | Invites are hashed, expiring, single-use and bound to the authenticated verified email. |
| SEC-08 | Cron is POST-only, fails closed and uses a 32+ character secret with constant-time comparison. |
| SEC-09 | Next/Supabase/Stripe/Resend were upgraded to compatible patched releases; npm audit is clean. |
| SEC-10 | Demo billing is impossible in production; raw tokens are gone; admin dashboard is server-authorized; email HTML/subjects are escaped; security headers and production env validation are active. |

### Location and performance

| Finding | Disposition |
|---|---|
| PERF-01–03 | Catalogue fetch replaced by viewport/zoom RPC, clusters, 150 default/200 hard feature bound, lazy detail, abort/stale protection and bounded list rendering. |
| PERF-04–05 | Middleware is limited to protected routes; public clients are cookie-free; fonts are local; Leaflet CSS is map-local. |
| PERF-06 | Wildcard Lucide imports removed from hot components; map/needs/detail bundles materially reduced. |
| PERF-07 | Notification polling occurs on panel open; navigation no longer performs duplicated global location/auth work. |
| PERF-08 | Evidence sources use uncapped database JSON aggregates; artifact publication is stateful and transactional. Long generation remains a candidate for the same job infrastructure if production latency warrants it. |
| PERF-09 | PostGIS GiST, trigram/search and domain hot indexes were added. |
| PERF-10 | Public map/detail fail closed; local needs/event fixtures are development-only, explicit and visibly labelled. Structured errors include request IDs. |

### Correctness, billing and evidence

| Finding | Disposition |
|---|---|
| COR-01 | Pledge validation, capacity, match and counter updates run under one locked transaction. |
| COR-02 | Volunteer capacity is locked; check-in requires a hashed expiring event token; checkout is idempotent and creates one hours row. |
| COR-03 | Stripe event claim/completion state supports retries and stale-claim recovery; failures are not marked processed. |
| COR-04 | Checkout rejects active/pending subscriptions, uses bounded idempotency and maps authoritative price IDs to tiers. |
| COR-05 | Company creation, invites, verification, delivery and acknowledgement are atomic state machines with authorization inside the transaction. |
| COR-06 | Artifact versions use an atomic counter; generating/ready/failed state and cleanup prevent collisions/orphan publication. |
| COR-07 | Receipt/report inputs come from uncapped acknowledgement-backed projections; cents and line counts reconcile before PDF/XML output. |
| COR-08 | Strict real-date parsing, integer-cent totals, bounded numeric inputs and evidence fixtures replace permissive JavaScript normalization. |
| COR-09 | Public company giving/institution metrics now require pledge acknowledgements and include an explicit evidence-basis marker. |

### Registry and data quality

| Finding | Disposition |
|---|---|
| DATA-01 | Versioned scored classification, candidate/reason fields, negative entity shapes and a review queue prevent broad-keyword auto-publication; donation acceptance remains unconfirmed until explicit confirmation. |
| DATA-02 | The complete official register is keyed by unique `UDR_ID`; optional/duplicated OIB is retained with a warning rather than dropping 3,190+ official rows. Every one of the 20 CTS fields, source hash/resource/update timestamp and current-snapshot state is retained. Processed staging JSON is removed to control storage growth. |
| DATA-03 | CKAN discovery plus bounded streaming download, source hashes, UDR/OIB validation, source-row checkpoints, adaptive timeout bisection, resumable set-based merges and exact-count constant-time publication make imports idempotent and fail closed. A scheduled GitHub workflow skips unchanged snapshots. |
| DATA-04 | Geocoding has durable state, attempt counts, retry time/backoff, permanent failure and a compliant rate/identity contract. |
| DATA-05 | Remapping and promotion are bounded/set-based; curated records win; dry-run counts are calculated from the same candidate set. |
| DATA-06 | Coverage is a database aggregate, not a capped client scan. |
| DATA-07 | The duplicate locale migration was renamed to a unique timestamp; CI rejects duplicate versions. |
| DATA-08 | The national directory uses immutable snapshot membership, a lean indexed projection, cached facets, bounded old-snapshot cleanup, server-side exact counts, Croatian collation, bounded pagination and allow-listed public RPCs. Production verification covers all 71,057 rows and denies anonymous base-table access. It shows every official status without treating registry presence as verification or donation eligibility. |

### Architecture and operations

| Finding | Disposition |
|---|---|
| ARCH-01 | Legacy company-action writes are retired (`410`); multi-tenant companies/members/campaigns are canonical. Historical rows remain read-only and explicitly unverified. |
| ARCH-02 | Shared security, auth, validation, date, environment, observability and domain transaction adapters reduce route duplication; critical business rules live in RPCs/helpers. |
| ARCH-03 | Explicit DTO projections and migration/schema contract tests remove broad public casts. Production migrations and grants were queried/applied through the authorized management API; deployed-schema type generation/diff remains a mandatory staging gate. |
| ARCH-04 | Public map, needs/events, evidence dates/numbers, environment, tokens and webhook boundaries have typed bounded validators. |
| ARCH-05–06 | Nearby fan-out moved to an idempotent outbox with locked claims, retry/backoff/dead state and indexed opt-in PostGIS recipient lookup. Imports/geocoding are durable offline jobs; artifacts publish transactionally and can move to the same worker pattern when observed duration requires it. |
| ARCH-07 | Non-interactive ESLint, strict route/type checks, Vitest, migration contracts, artifact tests, CI build/audit and Dependabot are committed. |
| ARCH-08–09 | Structured request-ID logs, instrumentation-time production environment validation, fail-closed clients and route error events are committed. External dashboards/alert routing are a deployment control. |
| ARCH-10 | Backup/restore, RPO/RTO, retention, deletion, secret rotation and incident procedures are now in `TECHNICAL_IMPLEMENTATION.md`; provider configuration/restore drill must be evidenced in staging. |
| ARCH-11 | Stale implementation/playbook docs were replaced by current architecture, auth, data flow, migration and runbook documentation. |
| ARCH-12 | The external card is a versioned public projection with wildcard read-only CORS and CDN caching; it exposes no credentialed surface. Latest reports require ready state and short signed URLs. |
| ARCH-13 | `.editorconfig`/`.gitattributes` enforce UTF-8/LF; Croatian fixtures and complete embedded TTF render tests cover document encoding. |

### Product, accessibility and design

| Finding | Disposition |
|---|---|
| UX-01–04 | Fast map shell, explicit loading/error/retry/truncation, trust/source details, real manual geocoding and suppression of hidden-location directions are implemented. |
| UX-05 | New/touched navigation, auth, pledge, theme, notification and document copy is bilingual; locale dictionaries remain the required home for user-facing additions. |
| UX-06–08 | Bounded accessible result list, concise labels/live regions, keyboard dialog focus lifecycle and URL-synchronized search/filter/selection are implemented. |
| UX-09 | Critical business/data work was moved out of map cards and mutation components into bounded APIs/RPCs. Further component extraction is maintainability work, not a release blocker. |
| UX-10 | Long Croatian PDF/DOCX/receipt fixtures, repeated headers, pagination, XML escaping and reconciliation are automated; every generated QA page was visually inspected. |
| UX-11 | Focus lifecycle and semantic contracts have automated unit coverage; map/dialog flows received keyboard/UI smoke testing. Full NVDA/VoiceOver certification remains a manual release checklist item. |
| UX-12 | Automated acknowledgement, registry provenance, unverified legacy action and informational tax/legal language are explicitly qualified. Legal/accounting approval remains an external publication gate. |

## Mandatory external release evidence

Do not describe production as remediated until the release owner records:

- successful migration application and schema/grant diff on a restored staging clone;
- Supabase CLI migration-history repair using the database password before adopting `db push`/Branching;
- Free-plan capacity ownership: upgrade to Pro before unattended full refreshes, or explicitly accept/monitor the 500 MB ceiling;
- passing anonymous/authenticated/service-role RLS and RPC smoke matrix;
- a current production backup plus successful quarterly restore drill owner/date;
- POST scheduler configuration for acknowledgement and notification workers;
- valid Stripe/Resend/SudReg webhook/email/control-channel tests;
- alert routing for 5xx, map p95, failed Stripe events, dead jobs and failed artifacts;
- privacy/legal/accounting approval for retention, exact-location treatment and receipt/report claims;
- manual keyboard plus NVDA or VoiceOver checks for map, pledge, auth, company and volunteer flows.
