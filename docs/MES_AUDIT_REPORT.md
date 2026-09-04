# Power2Go Battery MES Audit

Date: 2026-08-23

## Scope

Reviewed the application shell, authentication, navigation, production planning, 2D battery builder, cell/module/pack workflows, supplier import, warehouse inventory, QR/passport flows, traceability, quarantine, machine gateway, products, audit, reports, security, Supabase data access, local server routes, and schema definitions.

## Findings

### High

1. **Authorization is not enforced by the frontend permission model.** `AuthContext.hasPermission()` returns true only for admins and false for every other role, while most operational views call or expose actions without checking permissions. The Security screen stores granular permissions, but those permissions do not affect access. This creates a mismatch between the RBAC configuration UI and actual authorization behavior. Evidence: `src/context/AuthContext.tsx`, `src/components/security/SecurityView.tsx`, `src/components/planning/ProductionPlanningView.tsx`, `src/components/products/ProductConfiguratorView.tsx`, `src/components/quarantine/QuarantineView.tsx`.

2. **Destructive and state-changing operations are not consistently protected server-side.** Inventory update/delete methods write directly through Supabase from the browser, and the database policies shown grant broad authenticated write access to factory memory/component data. A user with a valid session may be able to mutate records outside the intended role boundary. Evidence: `src/services/api.ts`, `supabase/sql/auth_and_memory.sql`, `supabase/sql/up.sql`.

3. **Production writes are not transactional.** Order creation reserves cells, creates batteries/modules, and updates the order in multiple calls. A failure midway can leave reserved cells, orphan batteries/modules, or an order whose counts do not match inventory. The same pattern appears in multi-cell and multi-module workflow saves. Evidence: `src/services/api.ts` around `createProductionOrder`, `bulkSaveCellOcvIr`, `bulkSaveCellGrading`, and `bulkSaveModuleWorkflow`.

### Medium

4. **The Supabase and local-server implementations are behaviorally divergent.** The browser API primarily writes directly to Supabase, while `server/routes.ts` contains a separate in-memory/local implementation with different route behavior and state transitions. Fixes in one path can silently fail in the other. Evidence: `src/services/api.ts`, `server/routes.ts`, `server/db.ts`.

5. **State-machine enforcement is incomplete.** The server has strict transitions in the generic step route, but dedicated methods such as `finalTest`, `finalQc`, module welding/QC, and BMS testing do not all validate current state, prerequisites, or required linked components before writing. The Supabase methods are even more permissive. Evidence: `server/routes.ts`, `src/services/api.ts`.

6. **BMS/BMU component assignment is not symmetrical.** The Supabase BMU assignment updates the BMU record but does not update the battery `bmuId`, unlike the BMS path. That can make the BMU appear attached in one response but disappear from later warehouse/traceability queries. Evidence: `src/services/api.ts` in `scanComponent`.

7. **Final release can be asserted without verifying all quality gates.** `finalTest` writes a passed result using fallback/default values, and `finalQc` can release the battery without a server-side check that all required cells, modules, BMS/BMU, test results, and approvals are complete. Evidence: `src/services/api.ts` and `server/routes.ts` final test/QC handlers.

8. **Quarantine handling omits BMS/BMU in the API path.** The UI model includes BMS but not BMU in its manual quarantine type, and `quarantineItem` updates cells/modules/batteries but not controller records. A quarantined controller can therefore remain AVAILABLE. Evidence: `src/components/quarantine/QuarantineView.tsx`, `src/services/api.ts`, `src/types/index.ts`.

### Low

9. **The current-order indicator and role switcher are largely presentational.** The header displays a fixed `—` order value and the role switch action does not change the active role. This can mislead operators about context and capability. Evidence: `src/components/common/Header.tsx`.

10. **Several errors are logged only to the console.** Dashboard, inventory, reports, machines, supplier import, and other views do not consistently show a recoverable error state or retry action. Evidence: the corresponding view components.

11. **Destructive actions use browser prompts/confirms and status accepts arbitrary text.** This is fast for a prototype but permits invalid statuses, provides weak audit context, and is difficult to use on scanners/tablets. Evidence: `src/components/inventory/InventoryView.tsx` and related views.

12. **There is little automated coverage for the critical path.** No focused tests were found for duplicate component allocation, rollback after partial order creation, release prerequisites, role permissions, quarantine disposition, QR payload correctness, or Supabase/local parity.

## Recommended Order of Work

1. Enforce role permissions and server-side authorization for every mutation.
2. Move order creation, component assignment, workflow saves, and release into transaction/RPC boundaries with invariant checks.
3. Fix BMS/BMU linkage symmetry and quarantine coverage.
4. Make the state machine the single owner of all workflow transitions.
5. Add critical-path integration tests and a local/Supabase contract test suite.
6. Replace prompt-based CRUD with typed forms and controlled status options.
7. Add user-visible loading, empty, error, retry, and audit feedback states.

## Validation Performed

- `npm run build`: passed.
- `npx tsc --noEmit`: passed with no terminal output.
- VS Code diagnostics also surfaced a workspace dependency issue involving missing React declaration files; Vite still compiled the application successfully.

## Wireframe

See `docs/MES_WIREFRAME.html` and the exported `docs/MES_WIREFRAME.pdf`.
