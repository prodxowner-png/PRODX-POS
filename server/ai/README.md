# PRODX AI Provider Boundary

This directory contains the server-side, provider-neutral AI boundary for PRODX.

## CI code-review provider

The canonical CI code-review lane now uses Google Gemini through the Antigravity CLI. Provider credentials belong in the deployment secret manager and must never be committed or bundled into the browser.

Configure the GitHub Actions secret GEMINI_API_KEY. The review workflow sets Antigravity's modelProvider to gemini and uses headless structured output.

OpenRouter is no longer part of the canonical CI review lane. The application AI boundary remains provider-neutral; application runtime provider configuration is a separate concern from CI code review.

## Request flow

GitHub PR -> Antigravity CLI -> Gemini -> structured PRODX review -> PR comment -> CI decision

The review lane never exposes provider credentials to the browser. Its token is limited to repository read access plus PR/issue comments; it has no repository contents write permission. The automatic workflow is base-controlled and reviews only the exact head SHA it fetched.

## Production integration boundary

Application AI requests must remain behind the authenticated backend boundary so organization/user authorization, rate limits, quota policy, audit logging, and data-redaction rules are enforced before an AI request leaves PRODX.

## Verification

Provider tests use mocked implementations and never require a real provider API key.

Run the standard verification checks before changing the provider boundary:

```bash
npm run lint
npm run server:check
npm run server:test
npm run build
```
