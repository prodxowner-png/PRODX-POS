# PRODX AI Platform

## Architecture

PRODX owns the contracts, policy, tool registry, orchestration and audit boundaries. Gemini/Antigravity are model/execution providers.

### PRODX Assistant
User-facing POS assistant supporting text and voice channels and online/hybrid/offline runtime modes. It resolves transactional truth through PRODX domain services.

### PRODX Antigravity
System-facing engineering/operations agent driven by the Antigravity CLI. It can inspect code, run tests and diagnostics, and work on trusted repository branches under policy.

### Voice
Voice is a channel, not a permission boundary. Speech recognition and text-to-speech can be cloud or local. Offline mode may use local speech/intent capabilities, while deterministic PRODX tools remain authoritative.

### Hybrid/offline
The POS remains offline-first through the existing transaction/outbox architecture.
- Online: cloud model + PRODX services.
- Hybrid: cloud model when reachable; local deterministic tools/cached context otherwise.
- Offline: local tool/intent workflows only where supported.
No offline fallback may silently invent unavailable server state.

### Security
Every tool has actor allow-list, runtime-mode allow-list, authoritative flag and audit requirements owned by the underlying PRODX service. Protected operations remain behind authoritative service/gate controls.

### Provider independence
The core uses a provider interface so Gemini, Antigravity, or another model/runtime can be replaced without rewriting PRODX domain logic.

## Initial implementation scope
This slice establishes contracts and boundaries first. Product-specific tools, voice transport, local speech runtime, Gemini provider implementation and Antigravity CI executor are wired incrementally behind these interfaces.
