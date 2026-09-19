# Antigravity Google AI Pro runner for PRODX POS

This runbook prepares a persistent self-hosted Linux GitHub Actions runner to use the
signed-in Antigravity account session instead of GEMINI_API_KEY.

## Why this runner is required

Google documents that Antigravity headless mode uses cached credentials. A non-interactive
environment must already be authenticated; otherwise it exits with `authentication required`.
Google AI Pro quota is tied to the signed-in account, not to a Gemini API key.

## One-time machine setup

1. Use a dedicated Linux machine/VM for the runner.
2. Install Antigravity CLI 1.2.7 and verify its SHA-256:
   `e410dd56d8c213ef12643d3ff5eaaab57a17e05bbf72e9415322f23879fc4a18`.
3. Run `agy` interactively as the same OS user that will run the GitHub Actions runner.
4. Sign in with the Google account that owns the Google AI Pro subscription.
5. Run `/usage` and confirm the expected Pro model quota is visible.
6. Exit and run:
   `agy -p "Reply only PRODX_PRO_ACCOUNT_AUTH_OK" --model gemini-3.7-flash-medium --output-format json`
   Confirm status SUCCESS.
7. Keep the OS keyring/Secret Service available to that runner user. Do not export or copy
   Antigravity credential databases into GitHub secrets.
8. Register the GitHub Actions runner with labels:
   `self-hosted`, `linux`, `prodx-antigravity`.
9. Run the runner as the same user that completed the Antigravity sign-in.
10. Verify `GEMINI_API_KEY` is not present in the runner environment.

## Security requirements

- The runner is persistent and dedicated to this repository.
- Do not use `--dangerously-skip-permissions`.
- The review workflow sends only a sanitized, size-capped PR diff to Gemini.
- The reviewer receives no repository write token beyond the workflow's PR-comment permission.
- Never store Google account cookies, keyring exports, refresh tokens, or API keys in the repository.

## Validation

Run the GitHub workflow:

**Actions → Antigravity Pro Account AI Review → Run workflow**

Enter the PR number.

Only after this produces a real PASS/WARN/FAIL result should the canonical AI-review
workflow be migrated from the API-key provider to the Pro-account runner.

## Trust and exact-head requirements

- The automatic Gemini workflow is base-controlled (`pull_request_target`) and never checks out or executes pull-request code.
- It accepts only repository-owned pull requests, sanitizes the diff, refuses leaked credentials and refuses truncated diffs.
- It re-reads the pull-request head after downloading the diff and fails if the SHA changed during review.
- The review result is valid only for the exact head SHA that was reviewed; a later push requires a new run.
