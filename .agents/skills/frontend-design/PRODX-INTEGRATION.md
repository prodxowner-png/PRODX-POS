# PRODX-POS Integration Guardrails

This upstream frontend-design guidance is subordinate to the repository's `AGENTS.md`, approved product specifications, and all existing PRODX production/security gates.

- Preserve server authority, authentication and authorization, tenant/store isolation, RLS, grants, and append-only audit guarantees.
- Preserve financial and inventory invariants, idempotency, and offline-sync correctness.
- Do not change backend contracts, database policies, production configuration, or application dependencies as a side effect of visual design work.
- Reuse the existing PRODX design system and semantic tokens; coordinate with `ui-ux-pro-max`, `prodx-design-system`, `prodx-responsive-accessibility`, and `prodx-frontend-review` when those skills are present in the active workspace.
- Verify responsive behavior, keyboard access, focus visibility, contrast, reduced motion, and real interaction states before declaring completion.
- Skill guidance and generated UI are not evidence of passing CI, accessibility, security, or production-readiness gates.
