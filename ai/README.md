# PRODX AI Platform

PRODX AI is a dual-agent platform for PRODX POS.

- **PRODX Assistant**: user-facing POS assistant for chat and voice-assisted workflows.
- **PRODX Antigravity**: system-facing engineering and operations agent.
- **PRODX AI Core**: shared policy, tool, provider, voice, offline/hybrid and audit boundaries.

AI is never the financial, inventory, payment, authorization, or audit source of truth. AI requests must resolve through authoritative PRODX domain services/tools.

Runtime modes:
- Online: cloud model + authoritative PRODX APIs.
- Hybrid: cloud model when available, local deterministic tools and cached context when disconnected.
- Offline: POS continues through existing offline architecture; AI falls back to local intent/tool handling where supported.

See `docs/ai/prodx-ai-platform.md`.
