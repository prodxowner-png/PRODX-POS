# Dependency override policy

This file records why the root overrides in `package.json` exist and what must be checked before changing them. The overrides intentionally apply to the root installation graph; they are not permission to force an incompatible major into every nested consumer.

## Current overrides

| Package path | Locked version | Reason |
| --- | ---: | --- |
| Root `glob` | `14.0.4` | Includes fixes for GHSA-3g3m-2fjr-6pw4 (CVE-2026-118773; patched in `14.0.2`) and is beyond the vulnerable CLI ranges in GHSA-5j98-mcp5-4vw2 (CVE-2025-64756; fixed in `10.5.0` / `11.1.0`). |
| Root `minimatch` | `11.0.5` | Includes the fix for GHSA-g3hv-75wg-m249 (CVE-2026-118764; fixed in `11.0.1`). |
| `filelist` → `minimatch` | `5.1.9` | Preserves the `filelist` 1.x `^5.0.1` compatibility contract. Do not replace this nested dependency with minimatch 11 without proving API compatibility. |

The GitHub advisory record for GHSA-g3hv-75wg-m249 lists `>=7.0.0 <11.0.1`, while the upstream maintainer's advisory description identifies the 10.2.6 implementation and its fix in 11.0.1. The advisory's lower bound has been publicly questioned in [github/advisory-database#10811](https://github.com/github/advisory-database/issues/10811). The pinned `filelist` copy is 5.1.9, outside both the broad database range and the specifically described 10.2.6 implementation. Keep the nested compatibility pin explicit and revisit it if the advisory scope is clarified or `filelist` changes its API contract.

## Required validation

Run all of the following after an override or dependency change:

1. `npm ci --include=dev` using npm 11.21.2 and the strict lifecycle-script policy.
2. `npm audit --audit-level=moderate` and `npm audit signatures`.
3. `bun install --frozen-lockfile`.
4. `npm run dependency:overrides:check` to compare root overrides against both lockfiles.
5. Typecheck, PostgreSQL integration, build, and the complete required CI matrix.

When an intentional dependency update changes an exact `allowScripts` key, inspect the package's actual lifecycle script first. Use `npm approve-scripts <package>` only for a specifically reviewed script that is needed, then keep the resolved package version pinned in `allowScripts`. Do not approve all pending scripts or use an unversioned allow entry to avoid reviewing a dependency update.

## Advisory references

- [GHSA-3g3m-2fjr-6pw4 — glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [GHSA-5j98-mcp5-4vw2 — glob CLI command injection](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)
- [GHSA-g3hv-75wg-m249 — minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
