# Firebase retirement audit — PRODX-POS

Status: **IN PROGRESS — NOT safe to remove the SDK yet.**

The production POS data path is Supabase PostgreSQL behind the PRODX API. Firebase/Firestore code still exists in the frontend and must be removed by replacing each live call path first. This document is a migration checklist, not evidence that the migration is complete.

## Active Firebase/Firestore call paths

- `src/lib/firebase.ts`: initializes Firebase app, Auth, and Firestore. Central legacy entry point.
- `src/services/organizationService.ts`: organization, branch/store, terminal CRUD, subscriptions, local fallback, and audit history still use Firestore.
- `src/services/firestoreSyncStatusService.ts`: remote document reads/writes/deletes and a locally persisted sync queue still target Firestore.
- `src/services/auditService.ts`: diagnostic batch uploader and realtime/read paths target Firestore collections.
- `src/services/adminCredentialService.ts`: system-owner credential lookup/update and Firebase Auth reauthentication/password updates.
- `src/hooks/useTasks.ts`: task list/create/update/delete uses Firestore and Firebase Auth UID ownership.
- `src/services/workspace/gmailService.ts` and `src/components/workspace/GmailIntegrationModal.tsx`: Firebase Auth is used as a wrapper around Google OAuth for Gmail. Replace with direct Google OAuth; do not confuse Gmail's Google API with Firebase.
- `src/services/firebase/fcmService.ts`, `src/components/workspace/FcmNotificationWidget.tsx`, and `public/firebase-messaging-sw.js`: Firebase Cloud Messaging and registration token persistence. Requires a deliberate replacement (e.g. standards-based Web Push with a configured push provider) or an explicit feature retirement.
- `src/context/GlobalErrorRecoveryProvider.tsx`: migrated in this branch to the authenticated PostgreSQL-backed `POST /api/v1/audit/logs` route.
- `src/utils/systemHealthCheck.ts`, `src/components/admin/SystemHealthCheckCard.tsx`, `src/components/admin/RealtimeLatencyDiagnosticPanel.tsx`, `server/services/systemHealthCheckService.ts`, `server/http/infrastructureRoutes.ts`: health/latency paths migrated in this branch so they no longer make Firestore network probes; compatibility fields still label the retired provider as disabled.
- `scripts/validate-firestore-schema.ts`, `src/utils/firestore-schema-validation.test.ts`, `src/services/firestoreSyncStatusService.test.ts`: legacy schema/sync tests and script must be replaced with PostgreSQL-backed equivalents before deleting their production dependencies.

## Firebase-specific config and dependency artifacts

- `firebase-applet-config.json`
- `firebase.json`
- `firestore.rules`
- `firebase-blueprint.json`
- `package.json` dependency `firebase`
- `package.json` devDependency `@firebase/eslint-plugin-security-rules`
- `bun.lock`
- Security/docs references such as `security_spec.md` and generated `.aistudio/artifacts/**`

## Required migration order

1. Finish health/diagnostic cutover and pass typecheck, unit/integration tests, security checks, and CI.
2. Add PostgreSQL migrations and authenticated, tenant-scoped API routes for organization/store/device management; preserve existing authorization, validation, offline outbox, idempotency, and audit behavior.
3. Move diagnostic/audit batching to a PostgreSQL API with bounded batches, idempotency, retry handling, and authenticated store scope.
4. Move admin credential operations to the existing server-owned auth/credential boundary. Never move credential writes to a browser-side Supabase client or preserve local plaintext/hardcoded fallbacks.
5. Migrate task persistence to server-owned PostgreSQL tables/API with ownership enforced by the authenticated principal.
6. Replace Firebase Auth used only by Gmail with direct Google OAuth, preserving OAuth consent/scopes and token handling.
7. Replace or explicitly retire FCM; do not pretend browser Notification permission alone provides remote push.
8. Remove Firebase SDK, service worker, config, rules, stale tests/docs, and regenerate `bun.lock` only after a repository-wide import/reference scan proves no runtime imports remain.

## Completion gates

- No runtime imports from `firebase/*`, no `initializeApp` from Firebase, no Firestore REST calls, no Firebase config/service worker/rules.
- All migrated routes use authenticated server authority, tenant/store scope, permission checks, PostgreSQL transactions where needed, and audit trails.
- Offline/retry behavior is tested and idempotent; no Firestore-only queued writes remain.
- Unit, API, PostgreSQL integration, architecture/security gates, lint/typecheck/build, and CI pass.
- Production smoke tests prove the affected flows work end-to-end against Supabase before the Firebase project/dependencies are considered retired.
