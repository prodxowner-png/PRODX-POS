import assert from 'node:assert/strict';
import test from 'node:test';
import { runDeepFirestoreInspection } from '../../scripts/validate-firestore-schema';

test('runDeepFirestoreInspection validates Organizations, Branches, and Terminals against AuthContext schema', async () => {
  const report = await runDeepFirestoreInspection();

  assert.equal(typeof report.timestamp, 'string');
  assert.equal(report.targetDatabase, 'ai-studio-prodxpos-069bc919-d8b1-4f51-9f13-c61a86822990');
  assert.equal(report.targetProject, 'modified-bit-mct7q');

  // Verify collections stats
  assert.ok(report.stats.organizations.total >= 2);
  assert.equal(report.stats.organizations.errors, 0);

  assert.ok(report.stats.branches.total >= 3);
  assert.equal(report.stats.branches.errors, 0);

  assert.ok(report.stats.terminals.total >= 4);
  assert.equal(report.stats.terminals.errors, 0);

  // Verify referential integrity
  assert.equal(report.referentialIntegrity.orphanedBranches.length, 0);
  assert.equal(report.referentialIntegrity.orphanedTerminals.length, 0);
  assert.equal(report.referentialIntegrity.mismatchedOrgInTerminals.length, 0);
  assert.equal(report.referentialIntegrity.duplicateSlugs.length, 0);

  // Verify AuthContext scope simulation passes 100%
  assert.ok(report.authContextSimulation.totalTestedCombinations >= 7);
  assert.equal(report.authContextSimulation.failedCombinations, 0);
  assert.equal(report.authContextSimulation.passedCombinations, report.authContextSimulation.totalTestedCombinations);

  assert.equal(report.isFullyCompliant, true);

  const { terminate } = await import('firebase/firestore');
  const { db } = await import('../lib/firebase');
  await terminate(db).catch(() => undefined);
});
