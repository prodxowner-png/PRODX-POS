# UI/UX Pro Max for PRODX-POS

Upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT; see LICENSE).

Use this skill for UI structure, visual design, interaction, accessibility, responsive layouts, typography, color, charts, and stack-specific frontend work. Detect the actual app stack and versions before selecting stack guidance.

## PRODX guardrails

- Preserve the approved PRODX design language and semantic tokens; extend the existing system rather than creating a competing theme.
- Guidance never authorizes changes to business logic, server authority, authentication, RLS, grants, audit append-only behavior, financial or inventory invariants, idempotency, or offline-sync guarantees.
- Validate real screens at mobile, tablet, and desktop breakpoints; do not claim completion from mockups or generated guidance alone.
- Treat search output as recommendations and verify applicability against repository code and accessibility requirements.

## Search

Run from repository root:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "retail POS dashboard cashier workflow" --design-system -p "PRODX POS"
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus modal" --domain ux
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "responsive layout" --stack react
```

Read `references/quick-reference.md` for full UX guidance and `references/pro-rules.md` before shipping native/mobile UI.
