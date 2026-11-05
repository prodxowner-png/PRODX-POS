import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migrationDir = path.join(root, 'db/migrations');
const manifestPath = path.join(migrationDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
  schemaVersion: number;
  baselineCommit: string;
  baselineMaxId: number;
  legacyDuplicateIds: string[];
  files: Record<string, string>;
};

if (manifest.schemaVersion !== 1 || !manifest.baselineCommit || !manifest.files) {
  throw new Error('Invalid migration governance manifest.');
}

const names = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const currentPaths = new Set(names.map((name) => path.posix.join('db/migrations', name)));
const baselinePaths = new Set(Object.keys(manifest.files));
const errors: string[] = [];
const baselineIds = new Map<string, string[]>();
for (const relativePath of baselinePaths) {
  const name = path.posix.basename(relativePath);
  const match = /^(\\d{4})_[a-z0-9][a-z0-9_-]*\\.sql$/.exec(name);
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
  const match = /^(\\d{4})_[a-z0-9][a-z0-9_-]*\\.sql$/.exec(name);
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
