# UI/UX Pro Max for PRODX-POS

Upstream source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT; see `LICENSE`).

This skill provides local searchable UI/UX design guidance for web, mobile, and desktop interfaces. Use it for design systems, visual style, accessibility, responsive layout, interaction, typography, color, charts, and stack-specific frontend guidance.

## PRODX guardrails

- Preserve the approved PRODX visual language and semantic tokens. Extend existing components/tokens; do not create a competing theme.
- This is design guidance, not authority to change business logic, server authority, authentication, RLS, grants, append-only audit records, financial/inventory invariants, idempotency, or offline-sync guarantees.
- Detect the actual stack and installed versions before stack-specific searches. Validate real screens at mobile, tablet, and desktop sizes.
- Search results are recommendations. Verify applicability and accessibility before implementation.

## Search

From the repository root:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "retail POS dashboard cashier workflow" --design-system -p "PRODX POS"
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus modal" --domain ux
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "responsive layout" --stack react
```

Read `references/quick-reference.md` for full UX rules and `references/pro-rules.md` before final delivery of native/mobile UI.
