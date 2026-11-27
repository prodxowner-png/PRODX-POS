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

async function getMaxMigrationId(rootDir) {
  const names = (await readdir(path.join(rootDir, 'db/migrations')))
    .filter((name) => name.endsWith('.sql'));
  let maxId = 45;
  for (const name of names) {
    const match = /^([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/.exec(name);
    if (match) {
      maxId = Math.max(maxId, Number(match[1]));
    }
  }
  return maxId;
}

function formatMigrationId(id) {
  return String(id).padStart(4, '0');
}

function isCiEnvironment() {
  const value = process.env.CI?.trim().toLowerCase();
  return Boolean(value && value !== 'false' && value !== '0');
}

async function nextMigrationId(candidate) {
  const maxId = Math.max(
    await getMaxMigrationId(trustedRoot),
    await getMaxMigrationId(candidate),
  );
  return formatMigrationId(maxId + 1);
}

async function trustedRootWithPostBaselineMigration(candidate) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prodx-trusted-migration-base-'));
  await cp(path.join(trustedRoot, 'db/migrations'), path.join(root, 'db/migrations'), { recursive: true });
  const maxId = candidate
    ? Math.max(await getMaxMigrationId(root), await getMaxMigrationId(candidate))
    : await getMaxMigrationId(root);
  const nextId = formatMigrationId(maxId + 1);
  const postBaselinePath = `db/migrations/${nextId}_post_baseline_fixture.sql`;
  await writeFile(path.join(root, postBaselinePath), `SELECT ${Number(nextId)};\n`);
  return { root, postBaselineId: nextId, postBaselinePath };
}

async function candidateFixtureCopy(t) {
  if (!fixtureRoot) {
    if (isCiEnvironment()) throw new Error('MIGRATION_CANDIDATE_ROOT must be set in CI; refusing to skip candidate verifier tests.');
    t.skip('MIGRATION_CANDIDATE_ROOT is not set; no full candidate fixture was supplied.');
    return null;
  }
  const fixtureManifest = path.join(fixtureRoot, 'db/migrations/manifest.json');
  if (!await lstat(fixtureManifest).then(() => true).catch(() => false)) {
    if (isCiEnvironment()) throw new Error('Candidate migration manifest is required in CI; refusing to skip verifier tests.');
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

test('trusted verifier rejects a new migration backfilled below the current trusted base maximum', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  const { root: trusted, postBaselineId, postBaselinePath } = await trustedRootWithPostBaselineMigration(candidate);
  try {
    await cp(path.join(trusted, postBaselinePath), path.join(candidate, postBaselinePath));
    await writeFile(path.join(candidate, 'db/migrations/0049_backfilled_after_release.sql'), 'SELECT 49;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trusted),
      new RegExp(`must be greater than trusted base maximum ${postBaselineId}`),
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
    await rm(trusted, { recursive: true, force: true });
  }
});

test('trusted verifier rejects modification of a migration merged after the pinned manifest baseline', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  const { root: trusted, postBaselinePath } = await trustedRootWithPostBaselineMigration(candidate);
  try {
    await cp(path.join(trusted, postBaselinePath), path.join(candidate, postBaselinePath));
    const filePath = path.join(candidate, postBaselinePath);
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
  const { root: trusted, postBaselinePath } = await trustedRootWithPostBaselineMigration(candidate);
  try {
    await cp(path.join(trusted, postBaselinePath), path.join(candidate, postBaselinePath));
    await rm(path.join(candidate, postBaselinePath));
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
  const { root: trusted, postBaselineId, postBaselinePath } = await trustedRootWithPostBaselineMigration(candidate);
  try {
    await cp(path.join(trusted, postBaselinePath), path.join(candidate, postBaselinePath));
    await writeFile(
      path.join(candidate, `db/migrations/${postBaselineId}_duplicate_after_merge.sql`),
      `SELECT ${Number(postBaselineId) + 1};\n`,
    );
    await assert.rejects(
      verifyMigrationGovernance(candidate, trusted),
      new RegExp(`Duplicate new migration ID ${postBaselineId}`),
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
    await rm(trusted, { recursive: true, force: true });
  }
});

test('trusted verifier rejects duplicate new migration IDs above the trusted base maximum', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await writeFile(path.join(candidate, `db/migrations/${nextId}_first_new.sql`), 'SELECT 1;\n');
    await writeFile(path.join(candidate, `db/migrations/${nextId}_second_new.sql`), 'SELECT 2;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      new RegExp(`Duplicate new migration ID ${nextId}`),
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects an empty new migration SQL file', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await writeFile(path.join(candidate, `db/migrations/${nextId}_empty_migration.sql`), '   \n\t\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /New migration is empty/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects an invalid new migration filename', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    await writeFile(path.join(candidate, 'db/migrations/invalid_migration_name.sql'), 'SELECT 1;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /New migration filename must use NNNN_description\.sql/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects symlinked new migrations and symlinked migrations directories', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await symlink(
      path.join(candidate, 'db/migrations/manifest.json'),
      path.join(candidate, `db/migrations/${nextId}_symlink_escape.sql`),
    );
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Refusing non-regular new migration/,
    );

    await rm(path.join(candidate, 'db/migrations'), { recursive: true, force: true });
    await symlink(path.join(trustedRoot, 'db/migrations'), path.join(candidate, 'db/migrations'));
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Refusing non-directory or symlink for candidate migrations directory/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier accepts a valid new migration strictly above the trusted base maximum', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await writeFile(path.join(candidate, `db/migrations/${nextId}_valid_new_migration.sql`), 'SELECT 1;\n');
    const result = await verifyMigrationGovernance(candidate, trustedRoot);
    assert.equal(result.status, 'passed');
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects subdirectories inside db/migrations', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await mkdir(path.join(candidate, 'db/migrations/subdir'), { recursive: true });
    await writeFile(path.join(candidate, `db/migrations/subdir/${nextId}_nested.sql`), 'SELECT 1;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Unexpected entry in db\/migrations.*db\/migrations\/subdir/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects uppercase .SQL files in db/migrations', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    const nextId = await nextMigrationId(candidate);
    await writeFile(path.join(candidate, `db/migrations/${nextId}_upper.SQL`), 'SELECT 1;\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      new RegExp(`Unexpected entry in db/migrations.*db/migrations/${nextId}_upper\\.SQL`),
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects non-.sql files in db/migrations', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    await writeFile(path.join(candidate, 'db/migrations/evil.txt'), 'not sql\n');
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Unexpected entry in db\/migrations.*db\/migrations\/evil\.txt/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});

test('trusted verifier rejects symlinked non-.sql entries in db/migrations', async (t) => {
  const candidate = await candidateFixtureCopy(t);
  if (!candidate) return;
  try {
    await symlink(
      path.join(candidate, 'db/migrations/manifest.json'),
      path.join(candidate, 'db/migrations/evil_link'),
    );
    await assert.rejects(
      verifyMigrationGovernance(candidate, trustedRoot),
      /Unexpected entry in db\/migrations.*db\/migrations\/evil_link/,
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});
