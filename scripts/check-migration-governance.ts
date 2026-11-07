import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migrationDir = path.join(root, 'db/migrations');
const manifestPath = path.join(migrationDir, 'manifest.json');
// Authenticate the policy file independently. Without this pin, a PR could
// weaken manifest.files or its allowlists and have this checker trust the edit.
const EXPECTED_MANIFEST_GIT_BLOB_SHA = '58b3a7341ceffa8e34dd2c31164ec999d77c3377';
const EXPECTED_BASELINE_COMMIT = '2bb1699ec5b5cf74d3790451083eddaa01c2f1bd';
const EXPECTED_BASELINE_FILE_COUNT = 47;
const EXPECTED_LEGACY_DUPLICATE_IDS = ['0014', '0025', '0028', '0040'];

const manifestBytes = await readFile(manifestPath);
const manifestBlobSha = createHash('sha1')
  .update(`blob ${manifestBytes.length}\0`)
  .update(manifestBytes)
  .digest('hex');
if (manifestBlobSha !== EXPECTED_MANIFEST_GIT_BLOB_SHA) {
  throw new Error(
    `Migration governance manifest integrity failure: expected ${EXPECTED_MANIFEST_GIT_BLOB_SHA}, got ${manifestBlobSha}. Update the pinned digest only with an independently reviewed baseline change.`,
  );
}

const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
  schemaVersion: number;
  baselineCommit: string;
  baselineMaxId: number;
  legacyDuplicateIds: string[];
  files: Record<string, string>;
};

if (manifest.schemaVersion !== 1 || manifest.baselineCommit !== EXPECTED_BASELINE_COMMIT || !manifest.files || Object.keys(manifest.files).length !== EXPECTED_BASELINE_FILE_COUNT || JSON.stringify([...manifest.legacyDuplicateIds].sort()) !== JSON.stringify(EXPECTED_LEGACY_DUPLICATE_IDS)) {
  throw new Error('Invalid migration governance manifest.');
}

const names = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const currentPaths = new Set(names.map((name) => path.posix.join('db/migrations', name)));
const baselinePaths = new Set(Object.keys(manifest.files));
const errors: string[] = [];
const baselineIds = new Map<string, string[]>();
for (const relativePath of baselinePaths) {
  const name = path.posix.basename(relativePath);
  const match = /^([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/.exec(name);
  if (!match) {
    errors.push(`Baseline migration filename is invalid: ${relativePath}`);
    continue;
  }
  const entries = baselineIds.get(match[1]) ?? [];
  entries.push(relativePath);
  baselineIds.set(match[1], entries);
}
const observedLegacyDuplicates = [...baselineIds.entries()]
  .filter(([, entries]) => entries.length > 1)
  .map(([id]) => id)
  .sort();
const declaredLegacyDuplicates = [...manifest.legacyDuplicateIds].sort();
if (JSON.stringify(observedLegacyDuplicates) !== JSON.stringify(declaredLegacyDuplicates)) {
  errors.push(`Legacy duplicate-ID allowlist mismatch: observed [${observedLegacyDuplicates.join(', ')}], declared [${declaredLegacyDuplicates.join(', ')}]`);
}
const observedBaselineMax = Math.max(...[...baselineIds.keys()].map(Number));
if (observedBaselineMax !== manifest.baselineMaxId) {
  errors.push(`Baseline maximum ID mismatch: observed ${observedBaselineMax}, declared ${manifest.baselineMaxId}`);
}

for (const [relativePath, expectedBlobSha] of Object.entries(manifest.files)) {
  if (!currentPaths.has(relativePath)) {
    errors.push(`Baseline migration was removed: ${relativePath}`);
    continue;
  }
  const content = await readFile(path.join(root, relativePath));
  const gitBlobSha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  if (gitBlobSha !== expectedBlobSha) errors.push(`Baseline migration was modified: ${relativePath}`);
}

const seenNewIds = new Map<string, string>();
for (const relativePath of currentPaths) {
  if (baselinePaths.has(relativePath)) continue;
  const name = path.posix.basename(relativePath);
  const match = /^([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/.exec(name);
  if (!match) {
    errors.push(`New migration filename must use NNNN_description.sql: ${relativePath}`);
    continue;
  }
  const id = match[1];
  if (Number(id) <= manifest.baselineMaxId) {
    errors.push(`New migration ID ${id} must be greater than baseline maximum ${String(manifest.baselineMaxId).padStart(4, '0')}: ${relativePath}`);
  }
  const previous = seenNewIds.get(id);
  if (previous) errors.push(`Duplicate new migration ID ${id}: ${previous} and ${relativePath}`);
  else seenNewIds.set(id, relativePath);
  const content = await readFile(path.join(root, relativePath), 'utf8');
  if (!content.trim()) errors.push(`New migration is empty: ${relativePath}`);
}

if (errors.length) {
  console.error('Migration governance FAILED:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Migration governance passed: ${baselinePaths.size} immutable baseline migrations; ${seenNewIds.size} new migration IDs; legacy collisions grandfathered: ${manifest.legacyDuplicateIds.join(', ')}.`);
}
