import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyMigrationGovernance } from './check-migration-governance-trusted.mjs';

const trustedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = process.env.MIGRATION_CANDIDATE_ROOT
  ? path.resolve(process.env.MIGRATION_CANDIDATE_ROOT)
  : null;

const extractPinnedConstant = (source, name) => {
  const match = source.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `Expected ${name} to be declared in both migration verifiers.`);
  return match[1].trim();
};

test('TypeScript and trusted migration verifiers keep immutable baseline pins synchronized', async () => {
  const [typescriptVerifier, trustedVerifier] = await Promise.all([
    readFile(path.join(trustedRoot, 'scripts/check-migration-governance.ts'), 'utf8'),
    readFile(path.join(trustedRoot, 'scripts/check-migration-governance-trusted.mjs'), 'utf8'),
  ]);
  for (const name of [
    'EXPECTED_MANIFEST_GIT_BLOB_SHA',
    'EXPECTED_BASELINE_COMMIT',
    'EXPECTED_BASELINE_FILE_COUNT',
    'EXPECTED_LEGACY_DUPLICATE_IDS',
  ]) {
    assert.equal(
      extractPinnedConstant(typescriptVerifier, name),
      extractPinnedConstant(trustedVerifier, name),
      `${name} must match between the standard and trusted verifiers.`,
    );
  }
});

async function temporaryCandidate() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prodx-migration-governance-'));
  await mkdir(path.join(root, 'db/migrations'), { recursive: true });
  return root;
}

async function trustedRootWithPostBaselineMigration() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prodx-trusted-migration-base-'));
  await cp(path.join(trustedRoot, 'db/migrations'), path.join(root, 'db/migrations'), { recursive: true });
  await writeFile(path.join(root, 'db/migrations/0050_post_baseline_fixture.sql'), 'SELECT 50;\n');
  return root;
}

async function candidateFixtureCopy(t) {
  if (!fixtureRoot) {
    if (process.env.CI === 'true') throw new Error('MIGRATION_CANDIDATE_ROOT must be set in CI; refusing to skip candidate verifier tests.');
    t.skip('MIGRATION_CANDIDATE_ROOT is not set; no full candidate fixture was supplied.');
    return null;
  }
  const fixtureManifest = path.join(fixtureRoot, 'db/migrations/manifest.json');
  if (!await lstat(fixtureManifest).then(() => true).catch(() => false)) {
    if (process.env.CI === 'true') throw new Error('Candidate migration manifest is required in CI; refusing to skip verifier tests.');
    t.skip('Candidate does not yet contain the migration baseline manifest.');
    return null;
  }
  const root = await temporaryCandidate();
  await cp(path.join(fixtureRoot, 'db/migrations'), path.join(root, 'db/migrations'), { recursive: true });
  return root;
}

test('candidate cannot remove the trusted migration manifest', async () => {
  const candidate = await temporaryCandidate();
  try {
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Required candidate migration manifest is missing/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('candidate cannot replace the pinned migration manifest', async () => {
  const candidate = await temporaryCandidate();
  try {
    await writeFile(path.join(candidate, 'db/migrations/manifest.json'), '{}');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /differs from the trusted base manifest/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier accepts the exact pinned candidate baseline', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const result = await verifyMigrationGovernance(candidate, trustedRoot);
    assert.equal(result.status, 'passed');
    assert.match(result.message, /47 immutable baseline migrations/);
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects modification of a baseline migration', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const manifest = JSON.parse(await readFile(path.join(candidate, 'db/migrations/manifest.json'), 'utf8'));
    const relativePath = Object.keys(manifest.files)[0];
    const filePath = path.join(candidate, relativePath);
    const original = await readFile(filePath, 'utf8');
    await writeFile(filePath, `${original}\n-- tampered\n`);
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Baseline migration was modified/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects symlinked baseline migrations', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const manifest = JSON.parse(await readFile(path.join(candidate, 'db/migrations/manifest.json'), 'utf8'));
    const relativePath = Object.keys(manifest.files)[0];
    const filePath = path.join(candidate, relativePath);
    await rm(filePath);
    await symlink(path.join(candidate, 'db/migrations/manifest.json'), filePath);
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Refusing non-regular baseline migration/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects migration IDs at or below the immutable baseline maximum', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    await writeFile(path.join(candidate, 'db/migrations/0045_duplicate_migration.sql'), 'SELECT 1;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /must be greater than baseline maximum 0045/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects modification of a migration merged after the pinned manifest baseline', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  const trusted = await trustedRootWithPostBaselineMigration();
  try {
    const relativePath = 'db/migrations/0050_post_baseline_fixture.sql';
    await cp(path.join(trusted, relativePath), path.join(candidate, relativePath));
    const filePath = path.join(candidate, relativePath);
    const original = await readFile(filePath, 'utf8');
    await writeFile(filePath, `${original}-- tampered after merge\n`);
    await assert.rejects(
      verifyMigrationGovernance(candidate, trusted),
      /Base migration was modified/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
    await rm(trusted, { recursive: true, force: true });
  }
});

test('trusted verifier rejects deletion of a migration merged after the pinned manifest baseline', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  const trusted = await trustedRootWithPostBaselineMigration();
  try {
    const relativePath = 'db/migrations/0050_post_baseline_fixture.sql';
    await cp(path.join(trusted, relativePath), path.join(candidate, relativePath));
    await rm(path.join(candidate, relativePath));
    await assert.rejects(
      verifyMigrationGovernance(candidate, trusted),
      /Base migration was removed/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
    await rm(trusted, { recursive: true, force: true });
  }
});

test('trusted verifier rejects a new migration that reuses an ID already present on the trusted base', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  const trusted = await trustedRootWithPostBaselineMigration();
  try {
    const trustedMigration = 'db/migrations/0050_post_baseline_fixture.sql';
    await cp(path.join(trusted, trustedMigration), path.join(candidate, trustedMigration));
    await writeFile(
      path.join(candidate, 'db/migrations/0050_duplicate_after_merge.sql'),
      'SELECT 51;\n',
    );
    await assert.rejects(
      verifyMigrationGovernance(candidate, trusted),
      /Duplicate new migration ID 0050/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
    await rm(trusted, { recursive: true, force: true });
  }
});
