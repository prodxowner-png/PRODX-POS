## Reverification after documentation updates — 2026-09-24

Current exact HEAD is 13d154b795b36fcceb5ccc54a8cdb599d358edb2. The deterministic workflows for this documentation-updated HEAD are currently queued/pending, so prior PASS evidence from b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b is historical evidence and is not claimed for the current HEAD. Gemini hosted review and autonomous Gemini runs are also queued.

# Antigravity / Gemini CI Review Runtime

## Current status — 2026-09-24

The canonical production application AI provider is Gemini only. The current CI review lane uses the pinned Antigravity CLI with a server-side GEMINI_API_KEY on GitHub-hosted runners. A signed-in Google AI Pro self-hosted runner is optional future engineering infrastructure, not a current production application dependency.

## Canonical review requirements

- Review the exact trusted PR HEAD.
- Fetch and sanitize only the required diff.
- Never execute untrusted pull-request code on a privileged self-hosted runner.
- Keep provider credentials out of the browser and repository.
- Require structured review output before treating the Gemini review gate as satisfied.
- A later push requires a new exact-head review.

## Current evidence

At HEAD b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b, deterministic repository gates pass. The Gemini hosted review and autonomous Gemini provider smoke did not produce a successful runtime verdict because the configured Gemini API lane returned quota-related 429 RESOURCE_EXHAUSTED. This is a provider-capacity blocker, not a passing AI gate.

## Security requirements

- Never use --dangerously-skip-permissions.
- Never copy Google account cookies, keyrings, refresh tokens, or API keys into the repository.
- Keep review credentials scoped to minimum workflow permissions.
- Treat provider runtime availability as an independently verifiable gate.

Google's current Gemini guidance recommends bounded exponential backoff with jitter for transient 429/5xx conditions and avoiding transient retries for client errors such as 400/403.
