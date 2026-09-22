# Gemini API hosted CI lane for PRODX POS

This lane runs the PRODX Gemini code-review and autonomous production workflows on
ephemeral GitHub-hosted Linux runners. It uses the repository secret `GEMINI_API_KEY`
and does not require a persistent self-hosted runner, Azure VM, or Google Cloud VM.

## Provider configuration

Antigravity CLI requires the Gemini provider to be selected explicitly:

```json
{"modelProvider":"gemini"}
```

The workflows write this configuration into the ephemeral runner's
`~/.gemini/antigravity-cli/settings.json` and inject `GEMINI_API_KEY` only into
the steps that invoke `agy`.

The API key is never committed to the repository.

## Review trust boundary

- Review uses `pull_request_target`.
- The review job does not checkout pull-request code.
- It accepts only repository-owned open PRs.
- The diff is sanitized for credentials and size-capped before being sent to Gemini.
- The PR head SHA is re-read after diff retrieval and must match the reviewed SHA.
- A later push requires a new review run.

## Autonomous execution boundary

- The autonomous job runs only for repository-owned PRs targeting `main`.
- Branch names are restricted by the existing trust contract.
- The exact trusted PR head is checked out.
- The task contract requires reading `AGENTS.md`, running applicable tests and gates,
  and treating infrastructure failures as BLOCKED rather than PASS.
- The agent must not merge PRs, change branch protection, change secrets, or use
  `--dangerously-skip-permissions`.
- The runner is ephemeral; no persistent Google account session is required.

## Pro-account lane

`.github/workflows/antigravity-pro-account-ai-review.yml` and
`docs/antigravity-pro-runner.md` remain the separate Google AI Pro account lane.
That lane still requires a persistent self-hosted Linux runner with a signed-in
Antigravity account.

This hosted lane intentionally uses Gemini API quota instead of Google AI Pro
consumer-account quota.

## Required repository configuration

Create the GitHub Actions secret:

`GEMINI_API_KEY`

Do not put the key in workflow source, repository files, issue comments, or chat.
