#!/usr/bin/env node
/**
 * Trusted migration-governance verifier.
 *
 * This file must be loaded from the protected base branch by the
 * pull_request_target workflow. The candidate checkout is read as data only;
 * no candidate scripts or workflows are executed.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_MANIFEST_GIT_BLOB_SHA = '58b3a7341ceffa8e34dd2c31164ec999d77c3377';
const EXPECTED_BASELINE_COMMIT = '2bb1699ec5b5cf74d3790451083eddaa01c2f1bd';
const EXPECTED_BASELINE_FILE_COUNT = 47;
const EXPECTED_LEGACY_DUPLICATE_IDS = ['0014', '0025', '0028', '0040'];

export function gitBlobSha(content) {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}

async function assertRealDirectory(directoryPath, label) {
  let info;
  try {
    info = await lstat(directoryPath);
  } catch {
    throw new Error(`Required ${label} is missing: ${directoryPath}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing non-directory or symlink for ${label}: ${directoryPath}`);
  }
}

async function readRegularFile(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    throw new Error(`Required ${label} is missing: ${filePath}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Refusing non-regular ${label}: ${filePath}`);
  }
  return readFile(filePath);
}

function assertSafeMigrationPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath.startsWith('db/migrations/') ||
    relativePath.split('/').length !== 3 ||
    path.posix.basename(relativePath) !== relativePath.split('/')[2] ||
    relativePath.includes('..') ||
    relativePath.includes('\\')
  ) {
    throw new Error(`Unsafe migration path in trusted manifest: ${String(relativePath)}`);
  }
}

export async function verifyMigrationGovernance(candidateRoot, trustedRoot) {
  const candidate = path.resolve(candidateRoot);
  const trusted = path.resolve(trustedRoot);
  const candidateDir = path.join(candidate, 'db/migrations');
  const candidateManifest = path.join(candidateDir, 'manifest.json');
  const trustedManifest = path.join(trusted, 'db/migrations/manifest.json');

  await assertRealDirectory(candidate, 'candidate root');
  await assertRealDirectory(path.join(candidate, 'db'), 'candidate db directory');
  await assertRealDirectory(candidateDir, 'candidate migrations directory');
  await assertRealDirectory(trusted, 'trusted verifier root');
  await assertRealDirectory(path.join(trusted, 'db'), 'trusted db directory');
  await assertRealDirectory(path.join(trusted, 'db/migrations'), 'trusted migrations directory');

  const trustedManifestBytes = await readRegularFile(trustedManifest, 'trusted base migration manifest');
  const trustedManifestSha = gitBlobSha(trustedManifestBytes);
  if (trustedManifestSha !== EXPECTED_MANIFEST_GIT_BLOB_SHA) {
    throw new Error('Trusted base migration manifest differs from the verifier-pinned baseline.');
  }

  const candidateManifestBytes = await readRegularFile(candidateManifest, 'candidate migration manifest');
  const candidateManifestSha = gitBlobSha(candidateManifestBytes);
  if (candidateManifestSha !== trustedManifestSha) {
    throw new Error(
      `Candidate migration manifest differs from the trusted base manifest: expected ${trustedManifestSha}, got ${candidateManifestSha}.`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(trustedManifestBytes.toString('utf8'));
  } catch {
    throw new Error('Trusted base migration manifest is not valid JSON.');
  }

  if (
    manifest.schemaVersion !== 1 ||
    manifest.baselineCommit !== EXPECTED_BASELINE_COMMIT ||
    manifest.baselineMaxId !== 45 ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Object.keys(manifest.files).length !== EXPECTED_BASELINE_FILE_COUNT ||
    !Array.isArray(manifest.legacyDuplicateIds) ||
    JSON.stringify([...manifest.legacyDuplicateIds].sort()) !== JSON.stringify(EXPECTED_LEGACY_DUPLICATE_IDS)
  ) {
    throw new Error('Candidate migration manifest does not match the trusted baseline contract.');
  }

  const directoryInfo = await lstat(candidateDir);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error('Candidate migration directory must be a real directory, not a symlink.');
  }

  const names = (await readdir(candidateDir)).filter((name) => name.endsWith('.sql')).sort();
  const currentPaths = new Set(names.map((name) => path.posix.join('db/migrations', name)));
  const baselinePaths = new Set(Object.keys(manifest.files));
  const errors = [];
  const baselineIds = new Map();

  for (const relativePath of baselinePaths) {
    assertSafeMigrationPath(relativePath);
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
  if (JSON.stringify(observedLegacyDuplicates) !== JSON.stringify([...manifest.legacyDuplicateIds].sort())) {
    errors.push(`Legacy duplicate-ID allowlist mismatch: observed [${observedLegacyDuplicates.join(', ')}]`);
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
    try {
      const content = await readRegularFile(path.join(candidate, relativePath), 'baseline migration');
      if (gitBlobSha(content) !== expectedBlobSha) {
        errors.push(`Baseline migration was modified: ${relativePath}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  // The pinned manifest protects only the original baseline. Every migration
  // already present on the trusted base branch must also remain byte-for-byte
  // immutable, including migrations merged after that manifest was created.
  const trustedMigrationDir = path.join(trusted, 'db/migrations');
  const trustedMigrationNames = (await readdir(trustedMigrationDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of trustedMigrationNames) {
    const relativePath = path.posix.join('db/migrations', name);
    if (!currentPaths.has(relativePath)) {
      errors.push(`Base migration was removed: ${relativePath}`);
      continue;
    }
    try {
      const trustedContent = await readRegularFile(path.join(trusted, relativePath), 'trusted base migration');
      const candidateContent = await readRegularFile(path.join(candidate, relativePath), 'candidate base migration');
      if (gitBlobSha(candidateContent) !== gitBlobSha(trustedContent)) {
        errors.push(`Base migration was modified: ${relativePath}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const seenNewIds = new Map();
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
      errors.push(`New migration ID ${id} must be greater than baseline maximum 0045: ${relativePath}`);
    }
    const previous = seenNewIds.get(id);
    if (previous) errors.push(`Duplicate new migration ID ${id}: ${previous} and ${relativePath}`);
    else seenNewIds.set(id, relativePath);
    try {
      const content = await readRegularFile(path.join(candidate, relativePath), 'new migration');
      if (!content.toString('utf8').trim()) errors.push(`New migration is empty: ${relativePath}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) {
    throw new Error(`Migration governance FAILED:\n- ${errors.join('\n- ')}`);
  }

  return {
    status: 'passed',
    message: `Migration governance passed: ${baselinePaths.size} immutable baseline migrations; ${seenNewIds.size} new migration IDs; legacy collisions grandfathered: ${manifest.legacyDuplicateIds.join(', ')}.`,
  };
}

async function main() {
  const candidateRoot = process.argv[2];
  const trustedRoot = process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!candidateRoot) {
    throw new Error('Usage: node check-migration-governance-trusted.mjs <candidate-root> [trusted-root]');
  }
  const result = await verifyMigrationGovernance(candidateRoot, trustedRoot);
  console.log(`Trusted migration governance ${result.status}: ${result.message}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
