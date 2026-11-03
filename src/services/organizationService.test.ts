import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFirestoreFallbackReason,
  configureOrganizationResilience,
  executeWithOrganizationFallback,
  FirestoreConnectionTimeoutError,
  getBranchesByOrg,
  getOrganizationResilienceTelemetry,
  getOrganizationSelectionCatalogWithFallback,
  getOrganizations,
  getTerminalsByBranch,
  KeyValueStorageLike,
  readBranchesFromLocalStorage,
  readOrganizationsFromLocalStorage,
  readSelectionScopeFromLocalStorage,
  readTerminalsFromLocalStorage,
  saveBranchesToLocalStorage,
  saveOrganizationsToLocalStorage,
  saveSelectionScopeToLocalStorage,
  saveTerminalsToLocalStorage,
  setSimulatedFirestoreTimeout,
  withFirestoreTimeout,
} from './organizationService';
import type { Branch, Organization, Terminal } from '../modules/settings/types';

class MemoryStorage implements KeyValueStorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const CUSTOM_ORGS: Organization[] = [
  {
    id: 'org-cached-01',
    name: 'Cached Enterprise Retail',
    slug: 'cached-enterprise',
    currency: 'THB',
    status: 'active',
    createdAt: 1715000000000,
  },
];

const CUSTOM_BRANCHES: Branch[] = [
  {
    id: 'br-cached-01',
    orgId: 'org-cached-01',
    name: 'CACHED-01 Sukhumvit Flagship',
    code: 'CACHED-01',
    address: 'Sukhumvit Road, Bangkok',
    status: 'active',
    createdAt: 1715000001000,
  },
];

const CUSTOM_TERMINALS: Terminal[] = [
  {
    id: 'term-cached-01',
    branchId: 'br-cached-01',
    orgId: 'org-cached-01',
    name: 'Cached Express POS 1',
    code: 'POS-CACHED-01',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1715000002000,
  },
];

test('organizationService — withFirestoreTimeout rejects with FirestoreConnectionTimeoutError when promise exceeds timeoutMs', async () => {
  setSimulatedFirestoreTimeout(false);

  await assert.rejects(
    async () => {
      await withFirestoreTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 250)),
        'slowFirestoreQuery',
        30,
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof FirestoreConnectionTimeoutError);
      assert.equal(err.operation, 'slowFirestoreQuery');
      assert.equal(err.timeoutMs, 30);
      assert.equal(err.isTimeout, true);
      assert.equal(classifyFirestoreFallbackReason(err), 'timeout');
      return true;
    },
  );
});

test('organizationService — caches Organization, Branch, and Terminal records to localStorage and falls back on Firestore timeout', async () => {
  const memoryStorage = new MemoryStorage();
  configureOrganizationResilience({
    storage: memoryStorage,
    timeoutMs: 40,
    simulateTimeout: false,
  });

  // 1. Successful fetch writes to localStorage cache
  const initialCatalog = await getOrganizationSelectionCatalogWithFallback({
    timeoutMs: 100,
    customFirestoreLoader: async () => ({
      organizations: CUSTOM_ORGS,
      branches: CUSTOM_BRANCHES,
      terminals: CUSTOM_TERMINALS,
    }),
  });

  assert.equal(initialCatalog.source, 'firestore');
  assert.equal(initialCatalog.degraded, false);
  assert.equal(initialCatalog.timedOut, false);
  assert.equal(initialCatalog.organizations.length, 1);
  assert.equal(initialCatalog.organizations[0].slug, 'cached-enterprise');

  // Verify localStorage now holds cached records
  assert.equal(readOrganizationsFromLocalStorage()?.[0]?.id, 'org-cached-01');
  assert.equal(readBranchesFromLocalStorage('org-cached-01')?.[0]?.id, 'br-cached-01');
  assert.equal(
    readTerminalsFromLocalStorage('br-cached-01', 'org-cached-01')?.[0]?.code,
    'POS-CACHED-01',
  );

  // 2. Save user selection scope to localStorage
  saveSelectionScopeToLocalStorage({
    organizationId: 'org-cached-01',
    organizationSlug: 'cached-enterprise',
    organizationName: 'Cached Enterprise Retail',
    branchId: 'br-cached-01',
    branchName: 'CACHED-01 Sukhumvit Flagship',
    terminalId: 'term-cached-01',
    terminalCode: 'POS-CACHED-01',
  });

  const savedScope = readSelectionScopeFromLocalStorage();
  assert.equal(savedScope?.organizationSlug, 'cached-enterprise');
  assert.equal(savedScope?.branchName, 'CACHED-01 Sukhumvit Flagship');
  assert.equal(savedScope?.terminalCode, 'POS-CACHED-01');

  // 3. Firestore hangs and exceeds timeout -> service gracefully falls back to localStorage
  const degradedCatalog = await getOrganizationSelectionCatalogWithFallback({
    timeoutMs: 35,
    customFirestoreLoader: () => new Promise((resolve) => setTimeout(resolve, 300)),
  });

  assert.equal(degradedCatalog.source, 'localStorage');
  assert.equal(degradedCatalog.degraded, true);
  assert.equal(degradedCatalog.timedOut, true);
  assert.equal(degradedCatalog.fallbackReason, 'timeout');
  assert.equal(degradedCatalog.organizations[0].id, 'org-cached-01');
  assert.equal(degradedCatalog.branches[0].id, 'br-cached-01');
  assert.equal(degradedCatalog.terminals[0].code, 'POS-CACHED-01');
  assert.equal(degradedCatalog.savedSelection?.terminalCode, 'POS-CACHED-01');

  const telemetry = getOrganizationResilienceTelemetry();
  assert.equal(telemetry.lastSource, 'localStorage');
  assert.equal(telemetry.degraded, true);
  assert.equal(telemetry.timedOut, true);
  assert.ok(telemetry.consecutiveTimeouts >= 1);
});

test('organizationService — getOrganizations, getBranchesByOrg, and getTerminalsByBranch fall back to localStorage on connection timeout', async () => {
  const memoryStorage = new MemoryStorage();
  configureOrganizationResilience({
    storage: memoryStorage,
    timeoutMs: 35,
    simulateTimeout: false,
  });

  // Pre-populate localStorage with cached organization, branch, and terminal
  saveOrganizationsToLocalStorage(CUSTOM_ORGS);
  saveBranchesToLocalStorage(CUSTOM_BRANCHES, false);
  saveTerminalsToLocalStorage(CUSTOM_TERMINALS, false);

  const slowPromise = <T>(): Promise<T> => new Promise((resolve) => setTimeout(resolve, 250));

  const orgs = await getOrganizations({
    timeoutMs: 30,
    customFetcher: () => slowPromise<Organization[]>(),
  });
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].id, 'org-cached-01');

  const branches = await getBranchesByOrg('org-cached-01', {
    timeoutMs: 30,
    customFetcher: () => slowPromise<Branch[]>(),
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0].id, 'br-cached-01');

  const terminals = await getTerminalsByBranch('br-cached-01', 'org-cached-01', {
    timeoutMs: 30,
    customFetcher: () => slowPromise<Terminal[]>(),
  });
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].code, 'POS-CACHED-01');
});

test('organizationService — falls back to built-in DEFAULT_ORGS/BRANCHES/TERMINALS when localStorage is empty during timeout', async () => {
  const emptyStorage = new MemoryStorage();
  configureOrganizationResilience({
    storage: emptyStorage,
    timeoutMs: 30,
    simulateTimeout: true,
  });

  const fallbackCatalog = await getOrganizationSelectionCatalogWithFallback();

  assert.equal(fallbackCatalog.source, 'defaults');
  assert.equal(fallbackCatalog.degraded, true);
  assert.equal(fallbackCatalog.timedOut, true);
  assert.equal(fallbackCatalog.fallbackReason, 'simulated_timeout');
  assert.ok(fallbackCatalog.organizations.length >= 2);
  assert.ok(fallbackCatalog.branches.length >= 3);
  assert.ok(fallbackCatalog.terminals.length >= 4);

  // Clean up simulated timeout state
  setSimulatedFirestoreTimeout(false);
});
