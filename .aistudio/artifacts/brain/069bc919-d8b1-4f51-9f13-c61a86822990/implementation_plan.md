# PRODX-POS Production-Ready Migration Plan

## Objectives
1.  Migrate authoritative POS state from Firestore to PostgreSQL (Cloud SQL / PostgreSQL 15+).
2.  Enforce strict separation between the Admin Console and the POS login flow.
3.  Establish enterprise-grade security and RBAC.
4.  Ensure 100% production readiness (financial/inventory integrity, idempotency, auditability).

## Phase 1: Infrastructure & Database Migration (COMPLETED / PASS)
- [x] Provision and start PostgreSQL 15 instance (`127.0.0.1:5432/prodx_pos`) and normalize placeholder `DATABASE_URL` resolution in `server/db/postgres.ts`.
- [x] Apply and verify all 35 PostgreSQL schema migrations (`0001_m0_foundation` through `0033_security_prodx_app_role`) idempotently via `npm run db:migrate`.
- [x] Verify least-privilege runtime role (`prodx_app`), RLS policies, append-only audit triggers (`prodx_audit_log_immutable_guard`), and backup/restore drill (`pg_dump` / `pg_restore`).
- [x] Execute and pass all PostgreSQL integration tests (`server:test`, `server:test:integration`, `server:test:refund`, `sync-route.test.ts`, `timeclock-service.postgres.test.ts`).
- [x] Verify live runtime readiness (`/api/v1/readyz` and `/api/v1/infrastructure/system-health-check`).

## Phase 2: Authentication & Authorization Separation (COMPLETED / PASS)
- [x] Separate Admin authentication (OAuth/Firebase Auth / Owner Console via `/admin/login` and `/auth/admin/login`) from POS authentication (User/PIN/Biometric/QR Badge via `/` and `/auth/login`).
- [x] Implement strict RBAC enforcement on the backend (`server/http/auth-route.ts` `ADMIN_ROLE_REQUIRED` 403 gate with immediate session revocation, canonical permission mapping, and `requirePermission('settings.manage')` on infrastructure routes).
- [x] Create distinct UI flows for Admin Console and POS (`AdminLoginScreen.tsx`, `LoginScreen.tsx`, `OperatorPinPad.tsx`, `RbacGuard.tsx`, `Sidebar.tsx`, and `App.tsx`).

## Phase 3: Financial & Inventory Integrity (COMPLETED / PASS)
- [x] Replace floating-point arithmetic with exact BigInt / NUMERIC types for monetary calculations (`src/domain/money.ts`, `src/domain/order.ts`, `src/domain/taxInvoice.ts`, `server/shift/shift-service.ts`, `server/http/catalog-pricing-route.ts`, `server/http/catalog-import-route.ts`, `src/modules/shift/ShiftScreen.tsx`, `src/components/shift/StartShiftModal.tsx`, `src/components/orders/OrderRefundModal.tsx`, `src/components/inventory/BulkInventoryUploadModal.tsx`, `src/services/currency/currencyService.ts`).
- [x] Implement and verify atomic transaction boundaries for financial operations (`checkout`, `refund`, `void`, `shift`, `payment-lifecycle`, and server-authoritative `ReturnsAuthorizationModule.tsx`).
- [x] Build and verify idempotent inventory management services (`inventory-adjustment-service`, `catalog-import-route`, `catalog-pricing-route`, `InventoryScreen.tsx`).
- [x] Establish append-only auditable transaction logs (`POST /api/v1/audit/logs` and `GET /api/v1/audit/logs` in `server/http/audit-route.ts` and `server/audit/audit-service.ts` backed by `prodx_audit_log_immutable_guard`).

## Phase 4: Verification & Audit
- [ ] Implement automated regression tests (Unit, Integration, E2E).
- [ ] Run security, architecture, and lint gates.
- [ ] Finalize observability and audit events.
