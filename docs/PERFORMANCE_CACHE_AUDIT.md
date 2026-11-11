# MES performance, caching, and scalability audit

**Scope:** Read-only repository audit of login/first and repeat navigation, browser cache behavior, Supabase reads, large-data paths, and conditional Vercel/API concurrency risks.
**Deployment stated by user:** Vercel + Supabase.
**Safety:** No repository source/config/schema changes, production access, credentials, database diagnostics, or load tests were used. The repository worktree remained clean.

## A. Executive summary

Several repository-level behaviors plausibly explain slow cold loads and increasing work with more records:

1. **The CEO dashboard cold path fans out heavily.** `getDashboardStats()` starts a summary RPC, issued-cell read, 12 detail queries, and a warehouse snapshot. The snapshot issues four 1,000-row pages concurrently for each of `module_cells` and `cells` before it checks whether it can stop. With empty client caches and only one batch, this is about **27 PostgREST requests by source inspection**: 14 dashboard-side calls plus 13 snapshot calls. It can be more as those two tables exceed 4,000 rows. This count is a **code-derived estimate, not observed traffic**. The CEO dashboard can display its early summary callback before the full detail work completes; the standard dashboard awaits the full result.
2. **Cold modules have real code and data initialization costs.** `App.tsx` lazy-loads each screen on first visit, so first navigation includes its chunk load plus that screen's data requests. After first visit, `visitedViews` retains the mounted screen and hides it with CSS; its state is retained. This explains some warm-visit speedup without implying a shared or server-side cache. It also retains memory and allows polling effects in hidden dashboard and report screens to continue.
3. **Several normal reads scale with table size.** The warehouse snapshot loads all warehouse movements and fetches all cells and module-cell assignments; dashboard detail reads are largely unbounded. Reports fetch all cells in 1,000-row pages and select all records from six other tables. The summary SQL's “recent” battery/order/audit fields use `jsonb_agg(... order by ...) ... limit 20`; the outer limit is applied after aggregation and therefore does not limit rows entering the aggregate. These are concrete data-volume risks, though their production cost is not measured.
4. **Browser cache boundaries are unsafe for account switching.** Dashboard persistence uses one origin-wide localStorage key retained for up to three days; in-memory dashboard/warehouse/count/report/trace caches are module globals. Keys contain no authenticated user, organization/tenant, role, or permission context. Logout does not clear these caches. The CEO view consumes persisted summary data through an early callback before the new RPC completes. This is a **confirmed cache-scoping defect in code** and a **conditional cross-account disclosure risk** when sessions share the same browser origin; the live tenancy/role exposure and use of shared browsers were not verified.
5. **Current dashboard freshness cannot meet the requested 15-second target by code path alone.** The CEO polls every 15 seconds, but ordinary `getDashboardStats()` calls reuse a 30-second in-memory entry. A successful refresh of affected dashboard data is also not wired to every mutation; cache invalidation appears in selected issue/return paths.
6. **Concurrent-user capacity cannot be stated from the repository.** Browser-side caches are per page instance and cannot coalesce work across users. Legacy API session/OTP state is process-local, and authenticated custom API requests perform remote Supabase user/profile validation. These are conditional scale risks for those endpoints; the principal MES read path is direct browser-to-Supabase. No Vercel/Supabase limits, regions, plans, resource metrics, or load tests were available.

The code establishes mechanisms and risks, not measured production root causes or SLA status. Prioritize cross-user cache isolation first, then measure the actual path and reduce unbounded work/request duplication. Do **not** add shared caching or materialized summaries until data authorization and staleness requirements are designed and measured.

## B. Architecture and loading-path map

### Observed cold login / application path

`src/main.tsx` renders `App`; `App` wraps `AppContent` with `AuthProvider` and `AppProvider` (`src/App.tsx`, bottom-level provider; `src/context/AuthContext.tsx`).

- **Existing persisted session:** `AuthProvider` calls `supabase.auth.getSession()` → `applySession()` → a `profiles` query with a joined role/permission selection (`src/context/AuthContext.tsx`, lines 47, 96-121). The boot loader is not released until the awaited profile operation returns (`lines 102-120`). The profile query result is mapped to the current user (`lines 31-59, 81-94`).
- **Fresh email login:** `signInWithPassword()` → `applySession()` → profile query (`src/context/AuthContext.tsx`, lines 149-169). Username login adds `resolveLoginEmail()` → `email_for_username` RPC before password sign-in (`src/lib/supabaseBrowser.ts`, lines 34-43).
- **First authenticated view:** `AppContext` restores `p2g_activeView` from localStorage, defaulting to `ceo-monitoring` (`src/context/AppContext.tsx`, line 89). `AppContent` selects the corresponding lazy-loaded view and wraps it in `Suspense` (`src/App.tsx`, lines 16-36, 92-138, 157-177). The active view's first network reads are direct Supabase queries via `src/services/api.ts`.
- **CEO dashboard:** On mount the CEO view requests dashboard stats and sets a 15-second interval (`src/components/dashboard/CEOMonitoringView.tsx`, lines 282-365). `getDashboardStats()` launches the summary RPC, issued-cell query, 12 detail queries, and warehouse snapshot (`src/services/api.ts`, lines 896-967). The early `onSummary` callback occurs after the summary and issued-cell requests; the method still awaits detail and warehouse reads to finish before its final result (`src/services/api.ts`, lines 970-1024).
- **Standard dashboard:** Also launches a dashboard request, then polls every 60 seconds; it does not use the early-summary callback (`src/components/dashboard/DashboardView.tsx`, lines 30-52).

### First vs warm module navigation

- **Cold module:** The screen's chunk is downloaded/evaluated on first visit (`lazy()` declarations in `src/App.tsx`, lines 16-36), then component data loading starts. Inventory loads its first page and also unconditionally forces a dashboard refresh when `refreshKey` changes (`src/components/inventory/InventoryView.tsx`, lines 168-187).
- **Warm module:** Once visited, the screen stays mounted under a `hidden` CSS class (`src/App.tsx`, lines 42, 69-71, 169-175). Its code, React state, and fetched data remain in the page, so revisiting may avoid both chunk download and the initial component mount. This is component retention, not proof that every module has a correct data cache.
- **Long session:** The CEO, dashboard, and reports views have polling effects. Because visited screens remain mounted and CSS-hidden, the effects are not inherently stopped by in-app navigation. The timers check `document.hidden`, which refers to browser-tab visibility, not which MES view is active (`CEOMonitoringView.tsx`, lines 351-365; `DashboardView.tsx`, lines 38-52; `ReportsView.tsx`, lines 19-53).

### Requests that are actually blocking

Code inspection shows the CEO page can publish a partial summary early, but the normal dashboard awaits the full `getDashboardStats()` promise. First module chunk delivery and module-specific requests are necessarily on first visit unless prefetched. Which of these dominates perceived delay, and how much is network, database, JavaScript, or rendering, is **NOT MEASURED**.

## C. Specialist-agent findings and limitations

- **Agency Performance Benchmarker:** A focused earlier pass in this session reported the dashboard request fan-out, hidden dashboard polling, unscoped caches, and full-data reads. I independently checked these code paths and refined the request-count caveat and first-paint behavior in this report.
- **Expanded specialist delegation:** I attempted separate read-only workstreams with Agency Identity & Access Engineer, Frontend Developer, Performance Benchmarker, Database Optimizer, and SRE. The Frontend Developer agent reported it had no repository-read tools and returned no code findings. The other expanded sessions were cancelled before returning usable findings. **Their completion is not claimed.**
- **Consolidation:** The final source trace and checklist below were completed directly in the workspace by the lead assistant. No agent-produced measurements or live DB findings exist. Database plans, browser traces, and concurrency claims remain unverified.

## D. File-by-file checklist results

`ISSUE` means a behavior/inefficiency is confirmed in source; it does not imply a measured production outage. `RISK` means a plausible, source-supported concern requiring runtime or domain validation. `NOT VERIFIED` means evidence is unavailable. The safe actions below are recommendations only; nothing was changed.

| File | Status and source evidence | Impact / correctness and security | Minimal safe action, acceptance test, and missing evidence |
|---|---|---|---|
| [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx) | **RISK.** Session boot awaits profile/role mapping (`47-59, 96-120`); login awaits `signInWithPassword` and then profile load (`149-169`). Auth listener also calls `applySession` (`124-145`). | Profile lookup is on the authenticated UI path. `applySession` sets the current user after awaiting the profile, without checking that the same session is still current (`81-94`), so an older pending profile read could race a later account switch. Startup/login latency and frequency of this race are unmeasured. | Instrument session→profile→usable timings; add a generation/session identity guard before applying profile state and clear all data caches at auth boundaries. Test cold session restore, login, account switch during delayed profile response, logout during request, role change. Need browser traces and auth/profile latency. |
| [`src/context/AppContext.tsx`](../src/context/AppContext.tsx) | **RISK / data-fetching N/A.** It restores active view and UI state from localStorage (`useLocalStorage`, `26-42`; default `ceo-monitoring`, `88-90`), tracks history (`103-117`) and exposes `refreshKey` (`119`). No global Supabase dataset load is present in this provider. | Persisted route determines which screen loads first. Refresh is only a counter; it does not itself invalidate service caches. No direct global data load bottleneck found; runtime impact is not measured. | Record selected initial view and time-to-usable; keep route persistence deliberate. Test initial route and refresh/mutation behavior alongside cache invalidation. Need user workflow and browser timing evidence. |
| [`src/services/api.ts`](../src/services/api.ts) | **ISSUE.** Module-global caches and in-flight requests have no user/role key (`122-131`); dashboard key is just date range (`896-930`). Cold stats start RPC, issued cells, 12 details and warehouse (`934-967`); detail tables have broad reads. Warehouse snapshot fetches all movements and all rows from cells/module_cells (`438-477`), using four concurrent pages per 1,000-row batch (`449-464`). Reports and counts have additional broad/fan-out reads (`1467-1520`, `2323-2350`). | Warm cache can return data without repeating the RPC permission check. Cache may outlive logout/account/role switch. Requests are per browser and cannot reduce aggregate database work across users. Full scans, exact counts, and payloads grow with data. Forced refresh bypasses deduplication. | First fix principal/permission scoping and auth invalidation; then use measured request shapes to consolidate reads and bound/paginate interactive workflows, keeping exports explicit. Test result parity, cross-account isolation, no overlapping single-flight requests, count correctness, and freshness. Need request traces, row counts, Supabase plans and payload sizes. |
| [`src/App.tsx`](../src/App.tsx) | **ISSUE.** Screens are lazy loaded (`16-36`) and first visit adds to `visitedViews` (`69-71`); each visited screen is rendered and non-active views get `hidden` (`169-175`). | Lazy loading explains first-time chunk latency; retention plausibly explains faster warm visits but can accumulate DOM/state and keep effects alive. | Preserve lazy loading, measure per-chunk and navigation timing; gate polling/data refresh on `activeView`. Test cold/warm navigation and confirm zero inactive-view polling over 30 minutes. Need bundle analyzer/browser traces and memory profile. |
| [`src/components/dashboard/DashboardView.tsx`](../src/components/dashboard/DashboardView.tsx) | **ISSUE.** Fetch waits for full stats result (`30-46`); refresh runs at mount and every 60 seconds while the document is visible (`38-52`), without app-view awareness. | Can keep issuing reads while retained but hidden; ordinary cache TTL may suppress some interval calls, not necessarily every request. Main dashboard loading timing is unmeasured. | Stop interval/refresh while view is inactive and use explicit loading/error behavior. Test first paint, active refresh cadence, no hidden refresh, and mutation freshness. Need browser network trace and time-to-usable. |
| [`src/components/dashboard/CEOMonitoringView.tsx`](../src/components/dashboard/CEOMonitoringView.tsx) | **ISSUE.** Requests summary on mount and polls every 15 seconds (`282-365`). Early summary callback is applied to empty stats (`321-330`); cached callback can populate the visible dashboard before refreshed RPC completes. | The 15-second poll can return the same 30-second cached stats (`api.ts`, `899-930`), so poll frequency is not equivalent to freshness. Stale cached data can remain visible after a failed/unauthorized refresh; cross-user exposure is conditional on shared-origin account switching. | Make active-view polling respect <=15s freshness, invalidate/refetch affected summaries after successful mutations, and hide/clear cache data at user/permission transitions. Test cache-hit ages, account switch, denied RPC, offline/error case and mutation visibility. Need RUM, role/tenant model, and production freshness requirements. |
| [`src/components/inventory/InventoryView.tsx`](../src/components/inventory/InventoryView.tsx) | **ISSUE.** Search/status changes trigger loading (`168-175`); every `refreshKey` forces `getDashboardStats(..., true)` (`177-183`) while inventory reads occur independently. Status-filter fallbacks fetch pages sequentially to exhaustion (`60-68`, `253-305`); cells may request an unbounded result when status IDs are absent (`218-230`). | Inventory entry can duplicate dashboard work and full status lists become latency/memory proportional to dataset size. Page cache is component-local and keyed by filter/refresh, not an auth principal (`160-167, 197-236`). | Avoid unrelated forced dashboard reloads; page/filter server-side with bounded results while preserving explicit export/load-all behavior. Test all tabs/status/search, pagination, counts, result parity, and concurrent refreshes. Need representative table sizes, browser memory, and endpoint timings. |
| [`src/lib/appCacheCleanup.ts`](../src/lib/appCacheCleanup.ts) | **ISSUE.** A single `p2g_dashboard_stats_cache` key has up to three-day retention (`1-2, 6-21, 24-38`); value is not principal- or permission-scoped. Existing tests verify age cleanup/legacy shape only (`appCacheCleanup.test.ts`, `15-39`). | Storage survives logout and is origin-wide; cached dashboard values can be reused by a different signed-in user before revalidation. | Version and scope persistent keys to verified auth/permission context or remove sensitive persistent cache; clear on logout/account/role change. Test two users, roles, malformed/stale entries and pending-response-after-logout. Need confirmation of shared-browser use and allowed data sensitivity. |
| [`supabase/power2go_mes.sql`](../supabase/power2go_mes.sql) | **ISSUE / RISK.** `get_dashboard_summary` has repeated table aggregates and per-cell relationship checks (`3773-3863`); date filters cast timestamps (`3813-3814, 3834-3843`). “Recent” JSON aggregates put `LIMIT 20` outside `jsonb_agg` (`3935-3937`), so the limit does not bound aggregate input. Some status/date/junction indexes exist (`3047-3065`), but use is unverified. | Broad scans/aggregations grow with cell, test, order, and audit history. The recent fields can serialize whole tables, increasing DB work and RPC payload with growth. Any rewrite must preserve lifecycle bucket and permission semantics. | Correct recent-row subquery shape only after result-parity tests; inspect actual plans before index or materialization changes. Test seeded row counts >20, status totals, permissions, write latency, and boundaries. No EXPLAIN, live schema/index usage, row counts, RLS policy analysis, or Supabase resource evidence was available. |
| [`server/auth.ts`](../server/auth.ts) | **RISK.** Legacy sessions and pending OTP state are process-local `Map`s (`232-275`, pending map immediately following). | Serverless requests may land on a different instance and not see that state. Main frontend uses Supabase Auth directly, so the legacy path's production traffic is unknown. | Inventory calls to legacy cookie/OTP endpoints before migration; test multi-instance session behavior in staging if active. Need endpoint logs and deployed invocation map. |
| [`server/routes.ts`](../server/routes.ts) | **RISK.** Bearer middleware calls `getUserFromBearer` then `ensureLocalUserFromSupabase` for profile (`335-359`); `requirePermission` may perform a remote permission read on fallback (`363-390`). API routes also use local user/role state. | Custom `/api` endpoints can have multiple sequential Supabase round trips per request; this may add tail latency under concurrency. It is not the main browser read path. | Determine real `/api` route traffic; instrument stages and error/timeouts before optimizing. Test auth/RBAC invariants under concurrent requests. Need Vercel per-route latency/errors and endpoint volume. |
| [`server/supabase.ts`](../server/supabase.ts) | **RISK.** Client factories call `createClient` when invoked (`19-45`); `getUserFromBearer` constructs a client then makes `auth.getUser(token)` (`47-55`). | Per-call client construction and remote validation may add overhead on custom API routes; no pool/connection exhaustion claim is supported. Serverless instance reuse, Supabase region and limits are unknown. | Profile client creation and route latency first; only reuse clients where safe and never share user-bound auth headers across requests. Test concurrent identities and region/network timing. Need platform settings and telemetry. |
| [`vercel.json`](../vercel.json) | **NOT VERIFIED / limited config.** Contains Vite build/output and API/SPA rewrites only (`1-8`); no explicit function region, duration, or response cache headers are defined here. | Cannot establish the actual deployment region, default headers/CDN behavior, functions plan/limits, or cold-start contribution from this file. | Inspect read-only Vercel project/runtime settings and response headers after access is authorized. Test authenticated responses are never shared-cacheable; capture function region/duration and static chunk cache behavior. |

## E. Ranked root causes and risks

| ID | Severity | Confidence | Finding and impact | Regression risk |
|---|---|---|---|---|
| R1 | High | Confirmed in code; exposure conditional | User-independent browser caches and persistent dashboard data are not cleared on logout/account/role changes; dashboard cache hits bypass a fresh permission-gated RPC. Potential cross-account data disclosure on a shared browser/origin. | High if cache invalidation is incorrect; must test authorization/session transitions first. |
| R2 | High | Confirmed in code; runtime impact unmeasured | Cold CEO dashboard can initiate ~27 direct Supabase/PostgREST calls (code estimate), including full warehouse/cell/module assignment reads. Inventory can force another dashboard refresh. Each active user generates its own workload. | Medium: aggregation may change field semantics/row coverage if parity is missed. |
| R3 | High | Confirmed SQL structure; runtime impact unmeasured | `LIMIT 20` after `jsonb_agg` does not limit recent battery/order/audit rows; large histories can inflate RPC work and response. | Medium: correcting query must retain intended order and JSON fields. |
| R4 | High | Confirmed in code; runtime impact unmeasured | Visited modules are retained; hidden CEO/dashboard/reports timers remain mounted and can refresh while the app view is elsewhere. | Low to medium: ensure revisits refresh correctly and don't discard workflow state. |
| R5 | High | Confirmed in code; runtime impact unmeasured | Reports performs full-cell pagination and unbounded reads over six other tables; warehouse snapshot loads all movement history and related records. Memory, payload, and query work increase with dataset size. | Medium/high: normal browsing must remain accurate and exports complete. |
| R6 | Medium | Confirmed in code; SLA violation risk | CEO polling cadence is 15s while service dashboard cache TTL is 30s; other mutation invalidation is selective. Requested <=15s freshness is not guaranteed by this path. | Medium: freshness controls may increase load unless mutations invalidate targeted data. |
| R7 | Medium | Conditional / unverified | Process-local legacy sessions/OTP and per-request remote auth/profile checks may be fragile or slower across serverless instances. | Medium/high if those paths are active; first establish route usage. |
| R8 | Unverified | Not measured | Whether login delay is primarily auth/profile latency, Vercel cold start, chunk download, Supabase query time, browser rendering, or network/region distance. | N/A until measured. |

## F. Current performance baseline

**No runtime performance measurements were available. All metrics below are `NOT MEASURED`:**

- Login auth latency, profile query latency, and login-to-usable p50/p75/p95/sample count.
- First and warm navigation time for each module; chunk bytes/download/execute time; browser main-thread long tasks, memory, and Core Web Vitals.
- Real cold dashboard request count, bytes, cache-hit rate, Supabase latency, and time to first useful data. ~27 is a code-derived estimate only.
- Query execution plans, rows scanned/returned, CPU/I/O, index hit/use statistics, and live table sizes.
- Vercel function region, cold starts, per-route p95/error rate/duration, response headers, concurrency or plan/resource limits.
- Expected peak concurrency and staged 1x/2x/5x performance/error rates.

No RUM instrumentation was found in the application source. `@vercel/analytics` is rendered in `App.tsx` (`183`) but that alone does not establish Core Web Vitals, database timings, route request counts, or load capacity.

## G. Recommended optimization backlog (not implemented)

| ID | Minimal change and files | Dependency / expected improvement | Risk and acceptance | Rollback |
|---|---|---|---|---|
| B1 | Bind or clear all user-sensitive caches on auth identity/permission changes; guard async profile/data results against stale sessions. `AuthContext.tsx`, `api.ts`, `appCacheCleanup.ts`, relevant dashboard callers. | No dependency beyond confirming identity/role/tenant key. High correctness benefit; no speed claim. | Two-user/role-switch and delayed-request tests show zero old-user values after logout/switch; RPC permission still enforced. | Disable persistent cache and use fresh authorized reads; don't restore unscoped cache. |
| B2 | Make screen polling active-view-aware; prevent overlapping refreshes. `App.tsx`, CEO/dashboard/reports view effects. | Depends on B1 for safe view data lifecycle. Reduces avoidable repeated work. | Zero inactive-view refreshes in a 30-minute test; active refresh meets <=15s target without overlap. Revisit retains intended state. | Re-enable previous intervals only behind visible/active check if regression. |
| B3 | Bound interactive reads; paginate/filter warehouse, inventory, and reports; retain full-history reads only in explicit exports. `api.ts`, Inventory/Reports and consumers. | Requires report/inventory field/result contract inventory and sample datasets. Benefit grows with record volume. | Large seeded dataset: bounded response bytes and memory, correct counts, deterministic pages, complete explicit exports, no result omissions. | Feature-flag/bypass per module to original reader while preserving correctness. |
| B4 | Reduce duplicate cold dashboard reads and ensure dashboard summary `LIMIT` actually limits source rows; avoid repeated broad data hydration where one authorized, bounded query can satisfy UI. `api.ts`, `power2go_mes.sql`, dashboard components. | Requires complete dashboard field map, result parity fixtures, and measured payload/query plans. Potential substantial request/payload improvement; do not promise until measured. | Cold dashboard <=5 logical data requests (provisional), >=25% p75 time-to-usable improvement, parity in bucket totals/serials/permission behavior, no oversized response. | Restore prior client read path or SQL function behind versioned call; keep prior function until verified. |
| B5 | Tune date/status/join indexes or consider materialized/summary strategy only after real EXPLAIN and freshness/write analysis. `power2go_mes.sql` and versioned migrations if later approved. | Depends on B4 and production-like plans, data volumes, and <=15s freshness decision. Target >=25% p95 improvement for measured slow query. | Plan-based DB time/rows/reads improve with no material write-latency regression; summary parity and data freshness verified. | Revert to prior query/function/index path; materialized summary remains optional and not used unless refresh healthy. |
| B6 | Exercise realistic concurrency in approved staging and release incrementally with explicit thresholds. | Requires baseline, expected peak, representative data/roles, production-equivalent limits. | 1x/2x/5x expected peak; <1% errors over 60-minute peak hold, p95 within agreed SLO, stable DB use, zero cache leakage. | Stop ramp/roll back release if error, latency, resource, correctness, or auth threshold trips. |

## H. Scalability and concurrency assessment

- **As records grow:** warehouse movements are read without a limit; warehouse locations and module assignments hydrate all cells/assignments; dashboard detail queries and report analytics read full tables or scan them. Reports cell-page count scales as `ceil(cellCount/1000)` and launches all pages concurrently after a count. Cell status-count logic runs four exact count queries concurrently. Inventory status filters without cached dashboard IDs fetch pages sequentially until exhaustion. These patterns increase database work, transfer bytes, browser memory, or perceived latency with data volume.
- **As users grow:** per-tab memory caches reduce repeat work only within the same JS runtime. They do not provide cross-user request collapse. Hidden dashboard/report instances may keep producing per-user polling traffic. Whether Supabase can sustain the resulting load depends on its plan, project region, query plans, pool/resource limits, and actual user behavior; none were available.
- **Backend conditional risk:** the direct dashboard/inventory read path is browser → Supabase. Vercel API routes are used for selected operations (for example user and inventory-issue endpoints), not all reads. Those paths run through Express (`api/index.ts` → `createApiApp`) and include process-local legacy state and multiple bearer/profile verification calls. Establish route usage before treating these as a general login bottleneck.
- **Database candidates, not proven bottlenecks:** dashboard aggregate + per-cell relationship checks, date casts on timestamp fields, broad quality/audit/order/battery counts, warehouse movement history, report table reads. Obtain `EXPLAIN (ANALYZE, BUFFERS)` only in approved non-production or safe read-only conditions with representative data; do not add indexes based only on source inspection.
- **Concurrency test:** in staging only, ramp realistic role/action mixes at 1x/2x/5x expected peak; include cold logins, dashboard active/inactive views, inventory filtering, reports, and safe reads. Hold expected peak for 60 minutes. Capture p50/p75/p95, request bytes/count, errors/timeouts, Vercel duration/regions, Supabase CPU/I/O/connections/slow queries, and account-switch isolation. No production load is authorized.

## I. Safe implementation roadmap for approval

### Phase 1 — Baseline and critical cache correctness

- **Files:** `AuthContext.tsx`, `api.ts`, `appCacheCleanup.ts`, CEO dashboard cache callbacks; read-only Vercel/Supabase project settings.
- **Work:** instrument login-to-usable and major reads; identify route/role/tenant rules; scope or clear caches at logout/account/permission boundaries; guard pending responses from updating the wrong session.
- **Dependency/outcome:** establish 15-second dashboard freshness semantics and baseline; eliminate cross-user cache reuse before other cache changes.
- **Tests:** restored session/login/logout/account switch/role change; delayed previous-session profile/read completion; cached permission-denied path; mutation visibility.
- **Rollback:** preserve fresh authorized network reads; disable persistence rather than reverting to unscoped data.

### Phase 2 — Post-login and first-page loading optimization

- **Files:** `AuthContext.tsx`, `App.tsx`, dashboard and first-visit module components.
- **Work:** separate mandatory auth/profile work from non-blocking screen detail work; preserve permission gating; measure route chunks and first usable page; consider prefetch only for confirmed common next modules.
- **Dependency/outcome:** Phase 1 timings identify actual critical path. Provisional p75 targets: login <=3s, first module <=2s.
- **Tests:** cold cache/session and warm session, slow network, profile error, permission variants, UI parity; browser long-task/chunk measurements.
- **Rollback:** retain current lazy-load and fetch order behind a reversible flag if prefetch or concurrency regresses network/battery usage.

### Phase 3 — API request deduplication, caching, and pagination

- **Files:** `api.ts`, `App.tsx`, CEO/dashboard/reports and Inventory views.
- **Work:** poll only the active view, prevent overlapping work, consolidate duplicated dashboard/warehouse inputs after mapping actual consumers, bound standard browsing reads, and reserve full scans for explicit exports. Keep TTLs compatible with <=15s active dashboard freshness and invalidate affected summaries after successful mutations.
- **Dependency/outcome:** baseline, cache isolation, complete result-field/permission contract. Provisional goal <=5 cold dashboard logical requests and >=25% p75 improvement, while avoiding oversized aggregate responses.
- **Tests:** parity against existing dashboard/inventory/report output, all status filters/search/page boundaries, zero inactive polling, mutation refresh, request dedup, large synthetic datasets.
- **Rollback:** restore old reader per view or use versioned endpoint/RPC; maintain existing screen and export behavior.

### Phase 4 — Measured Supabase database optimization

- **Files:** `power2go_mes.sql` and approved versioned migrations only after evidence.
- **Work:** inspect slow query plans/index use, correct recent-row aggregate shape, tune predicates/indexes, and evaluate summary/materialization only if the staleness and write costs fit the <=15s requirement.
- **Dependency/outcome:** Phase 3 query shape and production-like representative data. Provisional goal >=25% p95 DB improvement for targeted slow queries.
- **Tests:** EXPLAIN before/after, row and bucket parity, role/permission checks, write-latency regression, freshness under writes.
- **Rollback:** keep old function/versioned migration path; do not make a materialized summary the sole source until refresh and parity are proven.

### Phase 5 — Concurrent-load validation and controlled rollout

- **Files:** no product changes required if previous phases pass; Vercel/Supabase observability and staging test harness may be needed after approval.
- **Work:** run staged 1x/2x/5x expected peak ramps and a 60-minute expected-peak hold, then gradual monitored rollout.
- **Dependency/outcome:** expected peak, representative dataset/role mix, environment parity, approved test data and budgets. Provisional goal <1% errors, p95 within agreed SLO, stable DB use, zero cross-user cached-data exposure and zero known critical regressions.
- **Tests:** cold login, first/warm module visits, account switching, active/inactive polling, reports/inventory, mutations, burst and endurance scenarios.
- **Rollback:** explicit automatic/manual stop thresholds on errors, p95, timeouts, resource saturation, stale/wrong data, or authorization; no production test until separately authorized.

## J. Scenarios and remaining evidence gaps

| Scenario | Repository conclusion | Runtime status |
|---|---|---|
| A — Fresh login | Existing session waits for Supabase profile/role mapping before releasing auth boot; username login adds an email-resolution RPC. | Duration and user impact **NOT MEASURED**. |
| B — First module | Lazy chunk plus each screen's initial data reads; CEO dashboard starts broad parallel queries. | Module timings/bytes **NOT MEASURED**. |
| C — Repeat module | Previously visited screen remains mounted/hidden and retains state; some service caches also expire after 15-60s. | Warm latency/cache-hit rate **NOT MEASURED**. |
| D — Session switching | Persistent/in-memory data caches lack user key and logout does not clear them. | Cross-account exposure is conditional; shared-browser/tenant model **NOT VERIFIED**. |
| E — Large datasets | Multiple all-row reads, aggregate-on-history SQL, and reports page through every cell. | Production row counts/query performance **NOT MEASURED**. |
| F — Concurrent users | Per-browser cache does not collapse across users; hidden polling adds avoidable work; legacy server maps are instance-local. | Capacity and expected peak **NOT MEASURED**; only approved staging tests. |
| G — Long sessions | Visited screen components remain mounted; dashboard/reports polls continue while their app view may be hidden. | Memory growth/request rates **NOT MEASURED**. |
| H — Mutations/correctness | Dashboard/warehouse invalidation appears in selected issue/return paths; ordinary TTL and mutation coverage are inconsistent. | End-to-end freshness after each workflow **NOT MEASURED**. |

Evidence still needed before implementation/capacity claims:

1. Vercel per-route traffic, regions, cold starts, duration, p95/errors/timeouts, configured plan and resource limits.
2. Supabase project region/plan, query performance/slow-query logs, CPU/I/O/connections, effective PostgREST row cap, actual schema/RLS policies and index usage.
3. Browser network/performance traces for representative roles and network/device classes; field p50/p75/p95/sample counts; actual dashboard request count/payload bytes and Core Web Vitals.
4. Expected concurrent users and peak behavior, representative cell/battery/module/test/order/audit/movement row counts, and 12-month growth.
5. Whether the MES is single-organization or tenant-scoped; role/permission changes and use of shared workstation browsers; required visibility of each dashboard field and serial.
6. Approved staging environment, representative safe dataset, test-user/action mix, test window/budget, and explicit production load-test authorization (none was provided).

## Read-only quality gate

- The 13 requested source/config paths were each reviewed or marked with limits above.
- Source claims have line references. No runtime timings, database plans, or concurrency outcomes are represented as facts.
- No production credentials were read; no database, load, or deployment action was performed.
- No source, configuration, migration, or schema file was modified.
- All recommended work remains a backlog/roadmap; implementation requires separate approval after production evidence and domain decisions.
