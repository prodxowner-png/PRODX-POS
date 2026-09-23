# PRODX AI Provider Boundary

This directory contains the server-side, provider-neutral AI boundary for PRODX.

## CI code-review provider

The canonical CI code-review lane now uses Google Gemini through the Antigravity CLI. Provider credentials belong in the deployment secret manager and must never be committed or bundled into the browser.

Configure the GitHub Actions secret GEMINI_API_KEY. The review workflow sets Antigravity's modelProvider to gemini and uses headless structured output.

Production application AI is Gemini-only. The server registry exposes exactly one provider (`gemini`), and non-Gemini provider identifiers are rejected.

## Request flow

GitHub PR -> Antigravity CLI -> Gemini -> structured PRODX review -> PR comment -> CI decision

The review lane never exposes provider credentials to the browser. Its token is limited to repository read access plus PR/issue comments; it has no repository contents write permission. The automatic workflow is base-controlled and reviews only the exact head SHA it fetched.

## Production integration boundary

Application AI requests are wired through `POST /api/v1/ai/chat` behind the authenticated backend boundary. The production registry contains only Gemini, while authorization, request budgets, audit logging, and data-redaction rules are enforced before an AI request leaves PRODX.

## Verification

Provider tests use mocked implementations and never require a real provider API key.

Run the standard verification checks before changing the provider boundary:

```bash
npm run lint
npm run server:check
npm run server:test
npm run build
```
