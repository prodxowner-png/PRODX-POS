import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const npmLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const bunLock = readFileSync('bun.lock', 'utf8');

const rootOverrides = packageJson.overrides;
const checks = [
  {
    label: 'glob',
    configuredVersion: rootOverrides.glob,
    npmPath: 'node_modules/glob',
    bunLockKey: 'glob',
    bunPackageName: 'glob',
  },
  {
    label: 'minimatch',
    configuredVersion: rootOverrides.minimatch,
    npmPath: 'node_modules/minimatch',
    bunLockKey: 'minimatch',
    bunPackageName: 'minimatch',
  },
  {
    label: 'filelist minimatch compatibility pin',
    configuredVersion: rootOverrides.filelist?.minimatch,
    npmPath: 'node_modules/filelist/node_modules/minimatch',
    bunLockKey: 'filelist/minimatch',
    bunPackageName: 'minimatch',
  },
];

for (const check of checks) {
  assert.equal(
    typeof check.configuredVersion,
    'string',
    `package.json is missing the ${check.label} override.`,
  );
  assert.equal(
    npmLock.packages[check.npmPath]?.version,
    check.configuredVersion,
    `package-lock.json does not resolve ${check.label} to ${check.configuredVersion}.`,
  );

  const expectedBunEntry = `"${check.bunLockKey}": ["${check.bunPackageName}@${check.configuredVersion}",`;
  assert.ok(
    bunLock.includes(expectedBunEntry),
    `bun.lock does not resolve ${check.label} to ${check.configuredVersion}.`,
  );
}

console.log('Dependency override parity verified across package.json, package-lock.json, and bun.lock.');
