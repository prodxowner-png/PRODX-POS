/**
 * PRODX POS - Organization, Store Branch & Terminal Firestore Service
 *
 * Provides centralized, systematic CRUD operations for managing enterprise organizations,
 * hierarchical store branches, and POS register terminal registrations in Google Cloud Firestore.
 * Enforces record-level data isolation, schema validation, transactional cascade semantics,
 * and a robust Firestore Connection Timeout & LocalStorage Fallback Error Handler for the
 * Organization, Branch, and Terminal selection flow.
 */

import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { Organization, Branch, Terminal, OrganizationAuditLog } from '../modules/settings/types';
import { assertOrganizationAdminAccess } from '../security/rbacMiddleware';
import { auditService } from './auditService';
import { firestoreSyncStatusService } from './firestoreSyncStatusService';
import type { KeyValueStorageLike } from '../domain/storage';
export type { KeyValueStorageLike };

export interface OrganizationActorContext {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
}

// ============================================================================
// Input Types & Interfaces
// ============================================================================

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  taxId?: string;
  phone?: string;
  email?: string;
  currency?: string;
  status?: 'active' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  currency?: string;
  status?: 'active' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface CreateBranchInput {
  orgId: string;
  name: string;
  address: string;
  code?: string;
  phone?: string;
  manager?: string;
  status?: 'active' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  code?: string;
  phone?: string;
  manager?: string;
  status?: 'active' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface CreateTerminalInput {
  branchId: string;
  name: string;
  code: string;
  orgId?: string;
  deviceModel?: string;
  ipAddress?: string;
  paperWidth?: '58mm' | '80mm';
  status?: 'active' | 'maintenance' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface UpdateTerminalInput {
  name?: string;
  code?: string;
  orgId?: string;
  deviceModel?: string;
  ipAddress?: string;
  paperWidth?: '58mm' | '80mm';
  status?: 'active' | 'maintenance' | 'inactive';
  actor?: OrganizationActorContext;
}

export interface BranchWithTerminals extends Branch {
  terminals: Terminal[];
}

export interface OrganizationHierarchyNode extends Organization {
  branches: BranchWithTerminals[];
  totalTerminals: number;
}

// ============================================================================
// Firestore Connection Timeout & LocalStorage Fallback Error Handler Types
// ============================================================================

export type OrganizationCatalogSource = 'firestore' | 'localStorage' | 'defaults';

export type OrganizationFallbackReason =
  | 'timeout'
  | 'network_error'
  | 'permission_error'
  | 'simulated_timeout'
  | 'empty_firestore'
  | 'unknown_error';

export interface OrganizationSelectionSavedScope {
  organizationId?: string;
  organizationSlug?: string;
  organizationName?: string;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  terminalId?: string;
  terminalCode?: string;
  terminalName?: string;
  updatedAt: number;
}

export interface OrganizationSelectionCatalogResult {
  organizations: Organization[];
  branches: Branch[];
  terminals: Terminal[];
  source: OrganizationCatalogSource;
  degraded: boolean;
  timedOut: boolean;
  fallbackReason?: OrganizationFallbackReason;
  errorMessage?: string;
  latencyMs: number;
  cachedAt: number | null;
  savedSelection: OrganizationSelectionSavedScope | null;
}

export interface OrganizationResilienceTelemetry {
  lastSource: OrganizationCatalogSource;
  degraded: boolean;
  timedOut: boolean;
  lastFallbackReason?: OrganizationFallbackReason;
  lastErrorMessage?: string;
  lastLatencyMs: number;
  lastSyncedAt: number | null;
  cachedCatalogTimestamp: number | null;
  consecutiveTimeouts: number;
  totalFallbacksTriggered: number;
  timeoutThresholdMs: number;
  simulatedTimeoutActive: boolean;
}

export const ORGANIZATION_STORAGE_KEYS = {
  ORGANIZATIONS_CACHE: 'prodx.org_service.cache.organizations.v1',
  BRANCHES_CACHE: 'prodx.org_service.cache.branches.v1',
  TERMINALS_CACHE: 'prodx.org_service.cache.terminals.v1',
  CATALOG_META: 'prodx.org_service.cache.meta.v1',
  SELECTED_SCOPE: 'prodx.org_service.selection.scope.v1',
  TERMINAL_ORG_SLUG: 'prodx.terminal.organization',
  TERMINAL_STORE_NAME: 'prodx.terminal.store',
  TERMINAL_REGISTER_CODE: 'prodx.terminal.register',
} as const;

export const DEFAULT_FIRESTORE_TIMEOUT_MS = 4500;

export class FirestoreConnectionTimeoutError extends Error {
  public readonly operation: string;
  public readonly timeoutMs: number;
  public readonly isTimeout = true;

  constructor(operation: string, timeoutMs: number, message?: string) {
    super(
      message ||
        `Firestore operation "${operation}" timed out after ${timeoutMs}ms. Falling back to localStorage cache.`,
    );
    this.name = 'FirestoreConnectionTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// Default Constants (Seeding & Ultimate Fallbacks)
// ============================================================================

export const DEFAULT_ORGS: Organization[] = [
  {
    id: 'org-prodx',
    name: 'PRODX Retail Group',
    slug: 'prodx',
    taxId: '0105562089412',
    phone: '+66-2-888-9000',
    email: 'contact@prodx-retail.com',
    currency: 'THB',
    status: 'active',
    createdAt: 1710000000000,
  },
  {
    id: 'org-siam',
    name: 'Siam Enterprise Commerce',
    slug: 'siam-enterprise',
    taxId: '0105559043211',
    phone: '+66-2-610-8000',
    email: 'admin@siam-enterprise.co.th',
    currency: 'THB',
    status: 'active',
    createdAt: 1710000001000,
  },
];

export const DEFAULT_BRANCHES: Branch[] = [
  {
    id: 'br-str-01',
    orgId: 'org-prodx',
    name: 'STR-01 Central World',
    code: 'STR-01',
    address: 'Bangkok Flagship Central World, 4th Floor',
    phone: '+66-2-888-9001',
    manager: 'Somchai Prasert',
    status: 'active',
    createdAt: 1710000000000,
  },
  {
    id: 'br-str-02',
    orgId: 'org-prodx',
    name: 'STR-02 Nimman',
    code: 'STR-02',
    address: 'Chiang Mai Nimman Branch, Soi 9',
    phone: '+66-53-222-300',
    manager: 'Anong Srisawat',
    status: 'active',
    createdAt: 1710000001000,
  },
  {
    id: 'br-siam-01',
    orgId: 'org-siam',
    name: 'SIAM-01 Siam Paragon',
    code: 'SIAM-01',
    address: 'Siam Paragon G Floor, Gourmet Zone',
    phone: '+66-2-610-8111',
    manager: 'Kittisak V.',
    status: 'active',
    createdAt: 1710000002000,
  },
];

export const DEFAULT_TERMINALS: Terminal[] = [
  {
    id: 'term-001',
    branchId: 'br-str-01',
    orgId: 'org-prodx',
    name: 'Main Checkout Counter 1',
    code: 'Terminal-001',
    deviceModel: 'Sunmi T2s Dual Screen',
    ipAddress: '192.168.1.101',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000000000,
  },
  {
    id: 'term-002',
    branchId: 'br-str-01',
    orgId: 'org-prodx',
    name: 'Express Lane Counter 2',
    code: 'Terminal-002',
    deviceModel: 'PAX E700 Integrated POS',
    ipAddress: '192.168.1.102',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000001000,
  },
  {
    id: 'term-admin-01',
    branchId: 'br-str-01',
    orgId: 'org-prodx',
    name: 'Administrator Console',
    code: 'ADMIN-CONSOLE',
    deviceModel: 'Administrative Workstation / Web',
    ipAddress: '127.0.0.1',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000000000,
  },
  {
    id: 'term-003',
    branchId: 'br-str-02',
    orgId: 'org-prodx',
    name: 'Nimman Main Register',
    code: 'Terminal-001',
    deviceModel: 'iPad Pro 11-inch with Stand',
    ipAddress: '192.168.2.50',
    paperWidth: '58mm',
    status: 'active',
    createdAt: 1710000002000,
  },
  {
    id: 'term-admin-02',
    branchId: 'br-str-02',
    orgId: 'org-prodx',
    name: 'Administrator Console',
    code: 'ADMIN-CONSOLE',
    deviceModel: 'Administrative Workstation / Web',
    ipAddress: '127.0.0.1',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000002000,
  },
  {
    id: 'term-004',
    branchId: 'br-siam-01',
    orgId: 'org-siam',
    name: 'Paragon Front Counter 1',
    code: 'Terminal-001',
    deviceModel: 'Elo Touch I-Series 4',
    ipAddress: '10.0.1.15',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000003000,
  },
  {
    id: 'term-admin-03',
    branchId: 'br-siam-01',
    orgId: 'org-siam',
    name: 'Administrator Console',
    code: 'ADMIN-CONSOLE',
    deviceModel: 'Administrative Workstation / Web',
    ipAddress: '127.0.0.1',
    paperWidth: '80mm',
    status: 'active',
    createdAt: 1710000003000,
  },
];

// ============================================================================
// Pluggable Storage & Resilience State Management
// ============================================================================

let customStorageAdapter: KeyValueStorageLike | null = null;
let configuredTimeoutMs = DEFAULT_FIRESTORE_TIMEOUT_MS;
let simulatedTimeoutActive = false;

const resilienceTelemetryState: OrganizationResilienceTelemetry = {
  lastSource: 'firestore',
  degraded: false,
  timedOut: false,
  lastLatencyMs: 0,
  lastSyncedAt: null,
  cachedCatalogTimestamp: null,
  consecutiveTimeouts: 0,
  totalFallbacksTriggered: 0,
  timeoutThresholdMs: DEFAULT_FIRESTORE_TIMEOUT_MS,
  simulatedTimeoutActive: false,
};

type ResilienceListener = (telemetry: OrganizationResilienceTelemetry) => void;
const resilienceListeners = new Set<ResilienceListener>();

function resolveStorage(): KeyValueStorageLike | null {
  if (customStorageAdapter) return customStorageAdapter;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function notifyResilienceListeners(): void {
  const snapshot = getOrganizationResilienceTelemetry();
  resilienceListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore listener error
    }
  });
}

/**
 * Configures a custom storage adapter or timeout threshold (useful for testing or custom runtimes).
 */
export function configureOrganizationResilience(options: {
  storage?: KeyValueStorageLike | null;
  timeoutMs?: number;
  simulateTimeout?: boolean;
}): void {
  if (options.storage !== undefined) {
    customStorageAdapter = options.storage;
  }
  if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
    configuredTimeoutMs = options.timeoutMs;
    resilienceTelemetryState.timeoutThresholdMs = options.timeoutMs;
  }
  if (typeof options.simulateTimeout === 'boolean') {
    simulatedTimeoutActive = options.simulateTimeout;
    resilienceTelemetryState.simulatedTimeoutActive = options.simulateTimeout;
  }
  notifyResilienceListeners();
}

/**
 * Toggles simulated Firestore connection timeout mode for resilience testing in UI/QA.
 */
export function setSimulatedFirestoreTimeout(active: boolean): void {
  simulatedTimeoutActive = active;
  resilienceTelemetryState.simulatedTimeoutActive = active;
  notifyResilienceListeners();
}

export function isSimulatedFirestoreTimeoutActive(): boolean {
  return simulatedTimeoutActive;
}

export function getOrganizationResilienceTelemetry(): OrganizationResilienceTelemetry {
  const meta = readCatalogCacheMetaFromLocalStorage();
  return {
    ...resilienceTelemetryState,
    cachedCatalogTimestamp: meta?.updatedAt ?? resilienceTelemetryState.cachedCatalogTimestamp,
    timeoutThresholdMs: configuredTimeoutMs,
    simulatedTimeoutActive,
  };
}

export function subscribeToOrganizationResilience(
  listener: ResilienceListener,
): Unsubscribe {
  resilienceListeners.add(listener);
  listener(getOrganizationResilienceTelemetry());
  return () => {
    resilienceListeners.delete(listener);
  };
}

// ============================================================================
// LocalStorage Cache Read/Write & Sanitization Helpers
// ============================================================================

function isValidOrganizationRecord(item: unknown): item is Organization {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.trim().length > 0 &&
    typeof obj.name === 'string' &&
    obj.name.trim().length > 0 &&
    typeof obj.slug === 'string' &&
    obj.slug.trim().length > 0
  );
}

function isValidBranchRecord(item: unknown): item is Branch {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.trim().length > 0 &&
    typeof obj.orgId === 'string' &&
    obj.orgId.trim().length > 0 &&
    typeof obj.name === 'string' &&
    obj.name.trim().length > 0
  );
}

function isValidTerminalRecord(item: unknown): item is Terminal {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.trim().length > 0 &&
    typeof obj.branchId === 'string' &&
    obj.branchId.trim().length > 0 &&
    typeof obj.name === 'string' &&
    typeof obj.code === 'string' &&
    obj.code.trim().length > 0
  );
}

export function readOrganizationsFromLocalStorage(): Organization[] | null {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORGANIZATION_STORAGE_KEYS.ORGANIZATIONS_CACHE);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isValidOrganizationRecord);
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export function saveOrganizationsToLocalStorage(organizations: Organization[]): void {
  const storage = resolveStorage();
  if (!storage || !Array.isArray(organizations) || organizations.length === 0) return;
  try {
    const valid = organizations.filter(isValidOrganizationRecord);
    if (valid.length === 0) return;
    storage.setItem(ORGANIZATION_STORAGE_KEYS.ORGANIZATIONS_CACHE, JSON.stringify(valid));
    updateCatalogCacheMetaInLocalStorage({ orgCount: valid.length });
  } catch {
    // Ignore storage quota errors
  }
}

export function readBranchesFromLocalStorage(orgId?: string): Branch[] | null {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORGANIZATION_STORAGE_KEYS.BRANCHES_CACHE);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isValidBranchRecord);
    if (valid.length === 0) return null;
    if (orgId && orgId.trim()) {
      const cleanOrgId = orgId.trim();
      return valid.filter((b) => b.orgId === cleanOrgId);
    }
    return valid;
  } catch {
    return null;
  }
}

export function saveBranchesToLocalStorage(branches: Branch[], mergeWithExisting = true): void {
  const storage = resolveStorage();
  if (!storage || !Array.isArray(branches) || branches.length === 0) return;
  try {
    const incomingValid = branches.filter(isValidBranchRecord);
    if (incomingValid.length === 0) return;

    let finalBranches = incomingValid;
    if (mergeWithExisting) {
      const existing = readBranchesFromLocalStorage() || [];
      const map = new Map<string, Branch>();
      existing.forEach((b) => map.set(b.id, b));
      incomingValid.forEach((b) => map.set(b.id, b));
      finalBranches = Array.from(map.values());
    }
    storage.setItem(ORGANIZATION_STORAGE_KEYS.BRANCHES_CACHE, JSON.stringify(finalBranches));
    updateCatalogCacheMetaInLocalStorage({ branchCount: finalBranches.length });
  } catch {
    // Ignore storage quota errors
  }
}

export function readTerminalsFromLocalStorage(branchId?: string, orgId?: string): Terminal[] | null {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORGANIZATION_STORAGE_KEYS.TERMINALS_CACHE);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isValidTerminalRecord);
    if (valid.length === 0) return null;

    return valid.filter((t) => {
      if (branchId && branchId.trim() && t.branchId !== branchId.trim()) return false;
      if (orgId && orgId.trim() && t.orgId && t.orgId !== orgId.trim()) return false;
      return true;
    });
  } catch {
    return null;
  }
}

export function saveTerminalsToLocalStorage(terminals: Terminal[], mergeWithExisting = true): void {
  const storage = resolveStorage();
  if (!storage || !Array.isArray(terminals) || terminals.length === 0) return;
  try {
    const incomingValid = terminals.filter(isValidTerminalRecord);
    if (incomingValid.length === 0) return;

    let finalTerminals = incomingValid;
    if (mergeWithExisting) {
      const existing = readTerminalsFromLocalStorage() || [];
      const map = new Map<string, Terminal>();
      existing.forEach((t) => map.set(t.id, t));
      incomingValid.forEach((t) => map.set(t.id, t));
      finalTerminals = Array.from(map.values());
    }
    storage.setItem(ORGANIZATION_STORAGE_KEYS.TERMINALS_CACHE, JSON.stringify(finalTerminals));
    updateCatalogCacheMetaInLocalStorage({ terminalCount: finalTerminals.length });
  } catch {
    // Ignore storage quota errors
  }
}

interface CatalogCacheMeta {
  updatedAt: number;
  orgCount?: number;
  branchCount?: number;
  terminalCount?: number;
}

function readCatalogCacheMetaFromLocalStorage(): CatalogCacheMeta | null {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORGANIZATION_STORAGE_KEYS.CATALOG_META);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.updatedAt === 'number') {
      return parsed as CatalogCacheMeta;
    }
    return null;
  } catch {
    return null;
  }
}

function updateCatalogCacheMetaInLocalStorage(partial: Partial<CatalogCacheMeta>): void {
  const storage = resolveStorage();
  if (!storage) return;
  try {
    const existing = readCatalogCacheMetaFromLocalStorage() || { updatedAt: Date.now() };
    const next: CatalogCacheMeta = {
      ...existing,
      ...partial,
      updatedAt: Date.now(),
    };
    resilienceTelemetryState.cachedCatalogTimestamp = next.updatedAt;
    storage.setItem(ORGANIZATION_STORAGE_KEYS.CATALOG_META, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

/**
 * Persists the user's selected Organization, Branch, and Terminal scope to localStorage
 * so the login selection flow recovers seamlessly across page reloads and Firestore outages.
 */
export function saveSelectionScopeToLocalStorage(scope: {
  organizationId?: string;
  organizationSlug?: string;
  organizationName?: string;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  terminalId?: string;
  terminalCode?: string;
  terminalName?: string;
}): void {
  const storage = resolveStorage();
  if (!storage) return;
  try {
    const payload: OrganizationSelectionSavedScope = {
      ...scope,
      updatedAt: Date.now(),
    };
    storage.setItem(ORGANIZATION_STORAGE_KEYS.SELECTED_SCOPE, JSON.stringify(payload));
    if (scope.organizationSlug) {
      storage.setItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_ORG_SLUG, scope.organizationSlug);
    }
    if (scope.branchName) {
      storage.setItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_STORE_NAME, scope.branchName);
    }
    if (scope.terminalCode) {
      storage.setItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_REGISTER_CODE, scope.terminalCode);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Reads the last saved Organization, Branch, and Terminal selection scope from localStorage.
 */
export function readSelectionScopeFromLocalStorage(): OrganizationSelectionSavedScope | null {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORGANIZATION_STORAGE_KEYS.SELECTED_SCOPE);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as OrganizationSelectionSavedScope;
      }
    }
    const rawOrgSlug = storage.getItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_ORG_SLUG);
    const rawBranchName = storage.getItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_STORE_NAME);
    const rawTerminalCode = storage.getItem(ORGANIZATION_STORAGE_KEYS.TERMINAL_REGISTER_CODE);

    const orgSlug = typeof rawOrgSlug === 'string' ? rawOrgSlug.trim() : undefined;
    const branchName = typeof rawBranchName === 'string' ? rawBranchName.trim() : undefined;
    const terminalCode = typeof rawTerminalCode === 'string' ? rawTerminalCode.trim() : undefined;

    if (orgSlug || branchName || terminalCode) {
      return {
        organizationSlug: orgSlug || undefined,
        branchName: branchName || undefined,
        terminalCode: terminalCode || undefined,
        updatedAt: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Seeds localStorage cache with default Organizations, Branches, and Terminals if no cache exists yet.
 */
export function seedLocalStorageCatalogIfEmpty(): void {
  if (!readOrganizationsFromLocalStorage()) {
    saveOrganizationsToLocalStorage(DEFAULT_ORGS);
  }
  if (!readBranchesFromLocalStorage()) {
    saveBranchesToLocalStorage(DEFAULT_BRANCHES, false);
  }
  if (!readTerminalsFromLocalStorage()) {
    saveTerminalsToLocalStorage(DEFAULT_TERMINALS, false);
  }
}

// ============================================================================
// Robust Firestore Error & Timeout Handler
// ============================================================================

export function classifyFirestoreFallbackReason(error: unknown): OrganizationFallbackReason {
  if (error instanceof FirestoreConnectionTimeoutError) {
    return simulatedTimeoutActive ? 'simulated_timeout' : 'timeout';
  }
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (msg.includes('simulated') && msg.includes('timeout')) return 'simulated_timeout';
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('deadline_exceeded')
  ) {
    return 'timeout';
  }
  if (
    msg.includes('permission-denied') ||
    msg.includes('permission_denied') ||
    msg.includes('insufficient permissions')
  ) {
    return 'permission_error';
  }
  if (
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('failed to get document') ||
    msg.includes('fetch')
  ) {
    return 'network_error';
  }
  return 'unknown_error';
}

/**
 * Executes a Firestore query/operation with a strict connection timeout guard.
 */
export async function withFirestoreTimeout<T>(
  operationPromiseFactory: () => Promise<T>,
  operationName: string,
  timeoutMs: number = configuredTimeoutMs,
): Promise<T> {
  if (simulatedTimeoutActive) {
    throw new FirestoreConnectionTimeoutError(
      operationName,
      timeoutMs,
      `Simulated Firestore connection timeout during "${operationName}" (${timeoutMs}ms threshold exceeded).`,
    );
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new FirestoreConnectionTimeoutError(operationName, timeoutMs));
    }, timeoutMs);
    if (timeoutHandle && typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
      (timeoutHandle as { unref?: () => void }).unref?.();
    }
  });

  try {
    return await Promise.race([operationPromiseFactory(), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export interface FallbackExecutionResult<T> {
  data: T;
  source: OrganizationCatalogSource;
  degraded: boolean;
  timedOut: boolean;
  fallbackReason?: OrganizationFallbackReason;
  errorMessage?: string;
  latencyMs: number;
}

/**
 * Robust error handler wrapper that executes a Firestore operation with a connection timeout,
 * automatically caches successful results to localStorage, and gracefully resolves fallback
 * data from localStorage (or built-in defaults) when a timeout or network failure occurs.
 */
export async function executeWithOrganizationFallback<T>(options: {
  operationName: string;
  timeoutMs?: number;
  firestoreOperation: () => Promise<T>;
  onSuccessCache?: (data: T) => void;
  readLocalStorageFallback: () => T | null;
  defaultFallback: T;
}): Promise<FallbackExecutionResult<T>> {
  const startMs = Date.now();
  const timeoutMs = options.timeoutMs ?? configuredTimeoutMs;

  try {
    const data = await withFirestoreTimeout(
      options.firestoreOperation,
      options.operationName,
      timeoutMs,
    );
    const latencyMs = Math.max(1, Date.now() - startMs);

    if (options.onSuccessCache) {
      try {
        options.onSuccessCache(data);
      } catch {
        // Ignore cache write failure
      }
    }

    resilienceTelemetryState.lastSource = 'firestore';
    resilienceTelemetryState.degraded = false;
    resilienceTelemetryState.timedOut = false;
    resilienceTelemetryState.lastFallbackReason = undefined;
    resilienceTelemetryState.lastErrorMessage = undefined;
    resilienceTelemetryState.lastLatencyMs = latencyMs;
    resilienceTelemetryState.lastSyncedAt = Date.now();
    resilienceTelemetryState.consecutiveTimeouts = 0;
    notifyResilienceListeners();

    return {
      data,
      source: 'firestore',
      degraded: false,
      timedOut: false,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const reason = classifyFirestoreFallbackReason(error);
    const timedOut = reason === 'timeout' || reason === 'simulated_timeout';
    const errorMessage = error instanceof Error ? error.message : String(error);

    const cachedData = options.readLocalStorageFallback();
    const resolvedSource: OrganizationCatalogSource =
      cachedData !== null ? 'localStorage' : 'defaults';
    const resolvedData: T = cachedData !== null ? cachedData : options.defaultFallback;

    // Ensure localStorage is warm if we had to fall all the way back to defaults
    if (cachedData === null && options.onSuccessCache) {
      try {
        options.onSuccessCache(options.defaultFallback);
      } catch {
        // Ignore
      }
    }

    resilienceTelemetryState.lastSource = resolvedSource;
    resilienceTelemetryState.degraded = true;
    resilienceTelemetryState.timedOut = timedOut;
    resilienceTelemetryState.lastFallbackReason = reason;
    resilienceTelemetryState.lastErrorMessage = errorMessage;
    resilienceTelemetryState.lastLatencyMs = latencyMs;
    resilienceTelemetryState.totalFallbacksTriggered += 1;
    if (timedOut) {
      resilienceTelemetryState.consecutiveTimeouts += 1;
    }
    notifyResilienceListeners();

    // Buffer a diagnostic event in the background audit service
    try {
      auditService.logDiagnosticEvent({
        level: timedOut ? 'WARN' : 'ERROR',
        category: 'network',
        event: timedOut ? 'FIRESTORE_CONNECTION_TIMEOUT' : 'FIRESTORE_FALLBACK_ACTIVE',
        deviceName: `organizationService.${options.operationName}`,
        message: `Firestore ${reason} during ${options.operationName} (${latencyMs}ms). Gracefully served fallback from ${resolvedSource}.`,
        metadata: {
          operationName: options.operationName,
          fallbackSource: resolvedSource,
          fallbackReason: reason,
          latencyMs,
          timeoutThresholdMs: timeoutMs,
          errorMessage,
        },
      });
    } catch {
      // Never block fallback flow on diagnostic logging
    }

    return {
      data: resolvedData,
      source: resolvedSource,
      degraded: true,
      timedOut,
      fallbackReason: reason,
      errorMessage,
      latencyMs,
    };
  }
}

let seedExecuted = false;

/**
 * Ensures initial default entities are written into Firestore if collections are empty.
 */
export async function ensureDefaultOrganizations(): Promise<void> {
  if (seedExecuted) return;
  seedExecuted = true;
  seedLocalStorageCatalogIfEmpty();
  try {
    await withFirestoreTimeout(
      async () => {
        for (const org of DEFAULT_ORGS) {
          await setDoc(doc(db, 'organizations', org.id), org);
        }
        for (const branch of DEFAULT_BRANCHES) {
          await setDoc(doc(db, 'branches', branch.id), branch);
        }
        for (const terminal of DEFAULT_TERMINALS) {
          await setDoc(doc(db, 'terminals', terminal.id), terminal);
        }
      },
      'ensureDefaultOrganizations',
      configuredTimeoutMs,
    );
  } catch {
    // Continue with localStorage / in-memory defaults if seeding cannot complete
  }
}

/**
 * Records an immutable audit entry in Firestore under collection 'audit_logs'
 */
export async function recordOrganizationAuditLog(input: {
  entityType: 'organization' | 'branch' | 'terminal';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'cascade_delete';
  entityName?: string;
  orgId?: string;
  branchId?: string;
  actor?: { id?: string; name?: string; email?: string; role?: string };
  details?: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
}): Promise<OrganizationAuditLog> {
  const id = `audit-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
  const log: OrganizationAuditLog = {
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    ...(input.entityName ? { entityName: input.entityName.slice(0, 160) } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.branchId ? { branchId: input.branchId } : {}),
    actor: input.actor || {
      id: 'admin-console',
      name: 'System Admin',
      email: 'admin@prodx.local',
      role: 'admin',
    },
    ...(input.details ? { details: input.details } : {}),
    ...(input.previousState ? { previousState: input.previousState } : {}),
    ...(input.newState ? { newState: input.newState } : {}),
    timestamp: Date.now(),
  };

  try {
    await withFirestoreTimeout(
      () => setDoc(doc(db, 'audit_logs', id), log),
      'recordOrganizationAuditLog',
      configuredTimeoutMs,
    );
  } catch (err) {
    console.warn('[AuditLog] Failed to persist audit record to Firestore:', err);
  }

  return log;
}

// ============================================================================
// 1. Organization Management (CRUD + Timeout & LocalStorage Fallback)
// ============================================================================

/**
 * Retrieves all registered organizations from Firestore with connection timeout protection
 * and automatic fallback to localStorage cache (or DEFAULT_ORGS).
 */
export async function getOrganizations(options?: {
  timeoutMs?: number;
   customFetcher?: () => Promise<Organization[]>;
}): Promise<Organization[]> {
  const result = await executeWithOrganizationFallback<Organization[]>({
    operationName: 'getOrganizations',
    timeoutMs: options?.timeoutMs,
    firestoreOperation: async () => {
      if (options?.customFetcher) {
        return options.customFetcher();
      }
      const q = collection(db, 'organizations');
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        await ensureDefaultOrganizations();
        const retry = await getDocs(q);
        if (!retry.empty) {
          return retry.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
        }
        return readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
      }
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
    },
    onSuccessCache: (orgs) => saveOrganizationsToLocalStorage(orgs),
    readLocalStorageFallback: () => readOrganizationsFromLocalStorage(),
    defaultFallback: DEFAULT_ORGS,
  });

  return result.data;
}

/**
 * Retrieves a single organization profile by document ID with localStorage fallback.
 */
export async function getOrganizationById(id: string): Promise<Organization | null> {
  if (!id || typeof id !== 'string') return null;
  const cleanId = id.trim();
  if (!cleanId) return null;

  const result = await executeWithOrganizationFallback<Organization | null>({
    operationName: `getOrganizationById(${cleanId})`,
    firestoreOperation: async () => {
      const snap = await getDoc(doc(db, 'organizations', cleanId));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() } as Organization;
      }
      const cached = readOrganizationsFromLocalStorage();
      return (
        cached?.find((o) => o.id === cleanId) ||
        DEFAULT_ORGS.find((o) => o.id === cleanId) ||
        null
      );
    },
    readLocalStorageFallback: () => {
      const cached = readOrganizationsFromLocalStorage();
      return cached ? cached.find((o) => o.id === cleanId) || null : null;
    },
    defaultFallback: DEFAULT_ORGS.find((o) => o.id === cleanId) || null,
  });

  return result.data;
}

/**
 * Retrieves an organization profile matching a unique slug with localStorage fallback.
 */
export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  if (!slug || typeof slug !== 'string') return null;
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) return null;

  const result = await executeWithOrganizationFallback<Organization | null>({
    operationName: `getOrganizationBySlug(${cleanSlug})`,
    firestoreOperation: async () => {
      const q = query(collection(db, 'organizations'), where('slug', '==', cleanSlug));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const first = snapshot.docs[0];
        return { id: first.id, ...first.data() } as Organization;
      }
      const cached = readOrganizationsFromLocalStorage();
      return (
        cached?.find((o) => o.slug.toLowerCase() === cleanSlug) ||
        DEFAULT_ORGS.find((o) => o.slug.toLowerCase() === cleanSlug) ||
        null
      );
    },
    readLocalStorageFallback: () => {
      const cached = readOrganizationsFromLocalStorage();
      return cached ? cached.find((o) => o.slug.toLowerCase() === cleanSlug) || null : null;
    },
    defaultFallback: DEFAULT_ORGS.find((o) => o.slug.toLowerCase() === cleanSlug) || null,
  });

  return result.data;
}

/**
 * Creates a new organization profile in Firestore and updates localStorage cache.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  assertOrganizationAdminAccess(input.actor, 'organization:create');
  const cleanSlug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) || 'org';
  const id = `org-${cleanSlug}-${Date.now().toString(36)}`;
  const record: Organization = {
    id,
    name: input.name.trim().slice(0, 120),
    slug: cleanSlug,
    ...(input.taxId ? { taxId: input.taxId.trim().slice(0, 64) } : {}),
    ...(input.phone ? { phone: input.phone.trim().slice(0, 32) } : {}),
    ...(input.email ? { email: input.email.trim().slice(0, 120) } : {}),
    ...(input.currency ? { currency: input.currency.trim().slice(0, 10) } : { currency: 'THB' }),
    status: input.status || 'active',
    createdAt: Date.now(),
  };

  try {
    await withFirestoreTimeout(
      () => setDoc(doc(db, 'organizations', id), record),
      `createOrganization(${id})`,
      configuredTimeoutMs,
    );
    const existingCache = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
    saveOrganizationsToLocalStorage([...existingCache.filter((o) => o.id !== id), record]);
    void recordOrganizationAuditLog({
      entityType: 'organization',
      entityId: record.id,
      action: 'create',
      entityName: record.name,
      orgId: record.id,
      actor: input.actor,
      newState: record as unknown as Record<string, unknown>,
      details: { slug: record.slug, currency: record.currency, status: record.status },
    });
    return record;
  } catch (error) {
    const reason = classifyFirestoreFallbackReason(error);
    if (reason === 'timeout' || reason === 'simulated_timeout' || reason === 'network_error') {
      const existingCache = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
      saveOrganizationsToLocalStorage([...existingCache.filter((o) => o.id !== id), record]);
      firestoreSyncStatusService.enqueuePendingWrite({
        collection: 'organizations',
        documentId: id,
        entityName: record.name,
        operation: 'create',
        localPayload: record as unknown as Record<string, unknown>,
        baseUpdatedAt: record.createdAt,
      });
      return record;
    }
    handleFirestoreError(error, OperationType.CREATE, `organizations/${id}`);
  }
}

/**
 * Updates an existing organization profile in Firestore while preserving immutable invariants.
 */
export async function updateOrganization(
  id: string,
  updates: UpdateOrganizationInput,
): Promise<Organization> {
  assertOrganizationAdminAccess(updates.actor, 'organization:update');
  const existing = await getOrganizationById(id);
  if (!existing) {
    throw new Error(`Organization with ID ${id} not found.`);
  }

  const record: Organization = {
    id: existing.id,
    name: updates.name !== undefined ? updates.name.trim().slice(0, 120) : existing.name,
    slug: updates.slug !== undefined
      ? updates.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)
      : existing.slug,
    ...(updates.taxId !== undefined ? { taxId: updates.taxId.trim().slice(0, 64) } : existing.taxId ? { taxId: existing.taxId } : {}),
    ...(updates.phone !== undefined ? { phone: updates.phone.trim().slice(0, 32) } : existing.phone ? { phone: existing.phone } : {}),
    ...(updates.email !== undefined ? { email: updates.email.trim().slice(0, 120) } : existing.email ? { email: existing.email } : {}),
    ...(updates.currency !== undefined ? { currency: updates.currency.trim().slice(0, 10) } : existing.currency ? { currency: existing.currency } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : existing.status ? { status: existing.status } : {}),
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  try {
    await withFirestoreTimeout(
      () => setDoc(doc(db, 'organizations', id), record),
      `updateOrganization(${id})`,
      configuredTimeoutMs,
    );
    const existingCache = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
    saveOrganizationsToLocalStorage(existingCache.map((o) => (o.id === id ? record : o)));
    void recordOrganizationAuditLog({
      entityType: 'organization',
      entityId: record.id,
      action: 'update',
      entityName: record.name,
      orgId: record.id,
      actor: updates.actor,
      previousState: existing as unknown as Record<string, unknown>,
      newState: record as unknown as Record<string, unknown>,
      details: updates as Record<string, unknown>,
    });
    return record;
  } catch (error) {
    const reason = classifyFirestoreFallbackReason(error);
    if (reason === 'timeout' || reason === 'simulated_timeout' || reason === 'network_error') {
      const existingCache = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
      saveOrganizationsToLocalStorage(existingCache.map((o) => (o.id === id ? record : o)));
      firestoreSyncStatusService.enqueuePendingWrite({
        collection: 'organizations',
        documentId: id,
        entityName: record.name,
        operation: 'update',
        localPayload: record as unknown as Record<string, unknown>,
        baseUpdatedAt: existing.updatedAt ?? existing.createdAt,
      });
      return record;
    }
    handleFirestoreError(error, OperationType.UPDATE, `organizations/${id}`);
  }
}

/**
 * Deletes an organization document from Firestore.
 */
export async function deleteOrganization(id: string, actor?: OrganizationActorContext): Promise<void> {
  assertOrganizationAdminAccess(actor, 'organization:delete');
  const existing = await getOrganizationById(id);
  try {
    await deleteDoc(doc(db, 'organizations', id));
    const existingCache = readOrganizationsFromLocalStorage();
    if (existingCache) {
      saveOrganizationsToLocalStorage(existingCache.filter((o) => o.id !== id));
    }
    void recordOrganizationAuditLog({
      entityType: 'organization',
      entityId: id,
      action: 'delete',
      entityName: existing?.name || id,
      orgId: id,
      actor,
      previousState: (existing as unknown as Record<string, unknown>) || undefined,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `organizations/${id}`);
  }
}

// ============================================================================
// 2. Hierarchical Store Branch Management (CRUD + Timeout & LocalStorage Fallback)
// ============================================================================

/**
 * Fetches store branches belonging to a specific organization with record-level filtering,
 * connection timeout protection, and localStorage fallback.
 */
export async function getBranchesByOrg(
  orgId: string,
  options?: {
    timeoutMs?: number;
    customFetcher?: () => Promise<Branch[]>;
  },
): Promise<Branch[]> {
  if (!orgId || typeof orgId !== 'string') return [];
  const cleanOrgId = orgId.trim();
  if (!cleanOrgId) return [];

  const result = await executeWithOrganizationFallback<Branch[]>({
    operationName: `getBranchesByOrg(${cleanOrgId})`,
    timeoutMs: options?.timeoutMs,
    firestoreOperation: async () => {
      if (options?.customFetcher) {
        const rows = await options.customFetcher();
        return rows.filter((b) => b.orgId === cleanOrgId);
      }
      const q = query(collection(db, 'branches'), where('orgId', '==', cleanOrgId));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        const cached = readBranchesFromLocalStorage(cleanOrgId);
        if (cached && cached.length > 0) return cached;
        return DEFAULT_BRANCHES.filter((b) => b.orgId === cleanOrgId);
      }
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Branch))
        .filter((b) => b.orgId === cleanOrgId);
    },
    onSuccessCache: (branches) => saveBranchesToLocalStorage(branches, true),
    readLocalStorageFallback: () => {
      const cached = readBranchesFromLocalStorage(cleanOrgId);
      return cached && cached.length > 0 ? cached : null;
    },
    defaultFallback: DEFAULT_BRANCHES.filter((b) => b.orgId === cleanOrgId),
  });

  return result.data;
}

/**
 * Fetches branches. If orgId is provided, enforces record-level isolation to that organization only.
 * Includes Firestore connection timeout protection and localStorage fallback.
 */
export async function getAllBranches(
  orgId?: string,
  options?: {
    timeoutMs?: number;
    customFetcher?: () => Promise<Branch[]>;
  },
): Promise<Branch[]> {
  if (orgId && orgId.trim()) {
    return getBranchesByOrg(orgId, options);
  }

  const result = await executeWithOrganizationFallback<Branch[]>({
    operationName: 'getAllBranches',
    timeoutMs: options?.timeoutMs,
    firestoreOperation: async () => {
      if (options?.customFetcher) {
        return options.customFetcher();
      }
      const q = collection(db, 'branches');
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        await ensureDefaultOrganizations();
        const retry = await getDocs(q);
        if (!retry.empty) {
          return retry.docs.map((d) => ({ id: d.id, ...d.data() } as Branch));
        }
        return readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
      }
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Branch));
    },
    onSuccessCache: (branches) => saveBranchesToLocalStorage(branches, false),
    readLocalStorageFallback: () => readBranchesFromLocalStorage(),
    defaultFallback: DEFAULT_BRANCHES,
  });

  return result.data;
}

/**
 * Retrieves a single branch by ID with optional orgId validation and localStorage fallback.
 */
export async function getBranchById(branchId: string, orgId?: string): Promise<Branch | null> {
  if (!branchId || typeof branchId !== 'string') return null;
  const cleanId = branchId.trim();
  if (!cleanId) return null;

  const filterByOrg = (branch: Branch | null): Branch | null => {
    if (!branch) return null;
    if (orgId && branch.orgId !== orgId.trim()) return null;
    return branch;
  };

  const result = await executeWithOrganizationFallback<Branch | null>({
    operationName: `getBranchById(${cleanId})`,
    firestoreOperation: async () => {
      const snap = await getDoc(doc(db, 'branches', cleanId));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Branch;
        return filterByOrg(data);
      }
      const cached = readBranchesFromLocalStorage();
      const foundCached = cached?.find((b) => b.id === cleanId) || null;
      if (foundCached) return filterByOrg(foundCached);
      return filterByOrg(DEFAULT_BRANCHES.find((b) => b.id === cleanId) || null);
    },
    readLocalStorageFallback: () => {
      const cached = readBranchesFromLocalStorage();
      if (!cached) return null;
      return filterByOrg(cached.find((b) => b.id === cleanId) || null);
    },
    defaultFallback: filterByOrg(DEFAULT_BRANCHES.find((b) => b.id === cleanId) || null),
  });

  return result.data;
}

/**
 * Creates a new store branch linked to its parent organization.
 */
export async function createBranch(input: CreateBranchInput): Promise<Branch> {
  assertOrganizationAdminAccess(input.actor, 'branch:create');
  const id = `br-${Date.now().toString(36)}`;
  const record: Branch = {
    id,
    orgId: input.orgId.trim().slice(0, 128),
    name: input.name.trim().slice(0, 120),
    address: input.address.trim().slice(0, 300),
    ...(input.code ? { code: input.code.trim().slice(0, 64) } : {}),
    ...(input.phone ? { phone: input.phone.trim().slice(0, 32) } : {}),
    ...(input.manager ? { manager: input.manager.trim().slice(0, 120) } : {}),
    status: input.status || 'active',
    createdAt: Date.now(),
  };

  try {
    await setDoc(doc(db, 'branches', id), record);
    saveBranchesToLocalStorage([record], true);
    void recordOrganizationAuditLog({
      entityType: 'branch',
      entityId: record.id,
      action: 'create',
      entityName: record.name,
      orgId: record.orgId,
      branchId: record.id,
      actor: input.actor,
      newState: record as unknown as Record<string, unknown>,
      details: { code: record.code, address: record.address, manager: record.manager },
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `branches/${id}`);
  }
}

/**
 * Updates a store branch document while maintaining organizational linkage.
 */
export async function updateBranch(
  branchId: string,
  updates: UpdateBranchInput,
): Promise<Branch> {
  assertOrganizationAdminAccess(updates.actor, 'branch:update');
  const existing = await getBranchById(branchId);
  if (!existing) {
    throw new Error(`Branch with ID ${branchId} not found.`);
  }

  const record: Branch = {
    id: existing.id,
    orgId: existing.orgId,
    name: updates.name !== undefined ? updates.name.trim().slice(0, 120) : existing.name,
    address: updates.address !== undefined ? updates.address.trim().slice(0, 300) : existing.address,
    ...(updates.code !== undefined ? { code: updates.code.trim().slice(0, 64) } : existing.code ? { code: existing.code } : {}),
    ...(updates.phone !== undefined ? { phone: updates.phone.trim().slice(0, 32) } : existing.phone ? { phone: existing.phone } : {}),
    ...(updates.manager !== undefined ? { manager: updates.manager.trim().slice(0, 120) } : existing.manager ? { manager: existing.manager } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : existing.status ? { status: existing.status } : {}),
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  try {
    await withFirestoreTimeout(
      () => setDoc(doc(db, 'branches', branchId), record),
      `updateBranch(${branchId})`,
      configuredTimeoutMs,
    );
    saveBranchesToLocalStorage([record], true);
    void recordOrganizationAuditLog({
      entityType: 'branch',
      entityId: record.id,
      action: 'update',
      entityName: record.name,
      orgId: record.orgId,
      branchId: record.id,
      actor: updates.actor,
      previousState: existing as unknown as Record<string, unknown>,
      newState: record as unknown as Record<string, unknown>,
      details: updates as Record<string, unknown>,
    });
    return record;
  } catch (error) {
    const reason = classifyFirestoreFallbackReason(error);
    if (reason === 'timeout' || reason === 'simulated_timeout' || reason === 'network_error') {
      saveBranchesToLocalStorage([record], true);
      firestoreSyncStatusService.enqueuePendingWrite({
        collection: 'branches',
        documentId: branchId,
        entityName: record.name,
        operation: 'update',
        localPayload: record as unknown as Record<string, unknown>,
        baseUpdatedAt: existing.updatedAt ?? existing.createdAt,
      });
      return record;
    }
    handleFirestoreError(error, OperationType.UPDATE, `branches/${branchId}`);
  }
}

/**
 * Deletes a branch document from Firestore.
 */
export async function deleteBranch(branchId: string, actor?: OrganizationActorContext): Promise<void> {
  assertOrganizationAdminAccess(actor, 'branch:delete');
  const existing = await getBranchById(branchId);
  try {
    await deleteDoc(doc(db, 'branches', branchId));
    const existingCache = readBranchesFromLocalStorage();
    if (existingCache) {
      saveBranchesToLocalStorage(existingCache.filter((b) => b.id !== branchId), false);
    }
    void recordOrganizationAuditLog({
      entityType: 'branch',
      entityId: branchId,
      action: 'delete',
      entityName: existing?.name || branchId,
      orgId: existing?.orgId,
      branchId,
      actor,
      previousState: (existing as unknown as Record<string, unknown>) || undefined,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `branches/${branchId}`);
  }
}

// ============================================================================
// 3. POS Terminal Registration Management (CRUD + Timeout & LocalStorage Fallback)
// ============================================================================

/**
 * Fetches terminals belonging to a branch with optional organization scoping,
 * connection timeout protection, and localStorage fallback.
 */
export async function getTerminalsByBranch(
  branchId: string,
  orgId?: string,
  options?: {
    timeoutMs?: number;
    customFetcher?: () => Promise<Terminal[]>;
  },
): Promise<Terminal[]> {
  if (!branchId || typeof branchId !== 'string') return [];
  const cleanBranchId = branchId.trim();
  if (!cleanBranchId) return [];

  const filterTerminals = (list: Terminal[]): Terminal[] =>
    list.filter((t) => {
      if (t.branchId !== cleanBranchId) return false;
      if (orgId && t.orgId && t.orgId !== orgId.trim()) return false;
      return true;
    });

  const result = await executeWithOrganizationFallback<Terminal[]>({
    operationName: `getTerminalsByBranch(${cleanBranchId})`,
    timeoutMs: options?.timeoutMs,
    firestoreOperation: async () => {
      if (options?.customFetcher) {
        const rows = await options.customFetcher();
        return filterTerminals(rows);
      }
      const q = query(collection(db, 'terminals'), where('branchId', '==', cleanBranchId));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        const cached = readTerminalsFromLocalStorage(cleanBranchId, orgId);
        if (cached && cached.length > 0) return cached;
        return filterTerminals(DEFAULT_TERMINALS);
      }
      const terminals = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Terminal));
      return filterTerminals(terminals);
    },
    onSuccessCache: (terminals) => saveTerminalsToLocalStorage(terminals, true),
    readLocalStorageFallback: () => {
      const cached = readTerminalsFromLocalStorage(cleanBranchId, orgId);
      return cached && cached.length > 0 ? cached : null;
    },
    defaultFallback: filterTerminals(DEFAULT_TERMINALS),
  });

  return result.data;
}

/**
 * Fetches all registered terminals with optional branch and organization scoping,
 * connection timeout protection, and localStorage fallback.
 */
export async function getAllTerminals(
  branchId?: string,
  orgId?: string,
  options?: {
    timeoutMs?: number;
    customFetcher?: () => Promise<Terminal[]>;
  },
): Promise<Terminal[]> {
  if (branchId && branchId.trim()) {
    return getTerminalsByBranch(branchId, orgId, options);
  }

  const filterByOrg = (list: Terminal[]): Terminal[] => {
    if (!orgId || !orgId.trim()) return list;
    const cleanOrgId = orgId.trim();
    return list.filter((t) => !t.orgId || t.orgId === cleanOrgId);
  };

  const result = await executeWithOrganizationFallback<Terminal[]>({
    operationName: 'getAllTerminals',
    timeoutMs: options?.timeoutMs,
    firestoreOperation: async () => {
      if (options?.customFetcher) {
        return filterByOrg(await options.customFetcher());
      }
      const q = collection(db, 'terminals');
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        await ensureDefaultOrganizations();
        const retry = await getDocs(q);
        if (!retry.empty) {
          return filterByOrg(retry.docs.map((d) => ({ id: d.id, ...d.data() } as Terminal)));
        }
        return filterByOrg(readTerminalsFromLocalStorage() || DEFAULT_TERMINALS);
      }
      return filterByOrg(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Terminal)));
    },
    onSuccessCache: (terminals) => saveTerminalsToLocalStorage(terminals, false),
    readLocalStorageFallback: () => readTerminalsFromLocalStorage(undefined, orgId),
    defaultFallback: filterByOrg(DEFAULT_TERMINALS),
  });

  return result.data;
}

/**
 * Retrieves a single terminal by ID, enforcing branch and organization isolation with localStorage fallback.
 */
export async function getTerminalById(
  terminalId: string,
  branchId?: string,
  orgId?: string,
): Promise<Terminal | null> {
  if (!terminalId || typeof terminalId !== 'string') return null;
  const cleanId = terminalId.trim();
  if (!cleanId) return null;

  const validateScope = (term: Terminal | null): Terminal | null => {
    if (!term) return null;
    if (branchId && term.branchId !== branchId.trim()) return null;
    if (orgId && term.orgId && term.orgId !== orgId.trim()) return null;
    return term;
  };

  const result = await executeWithOrganizationFallback<Terminal | null>({
    operationName: `getTerminalById(${cleanId})`,
    firestoreOperation: async () => {
      const docRef = doc(db, 'terminals', cleanId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Terminal;
        return validateScope(data);
      }
      const cached = readTerminalsFromLocalStorage();
      const foundCached = cached?.find((t) => t.id === cleanId || t.code === cleanId) || null;
      if (foundCached) return validateScope(foundCached);
      return validateScope(
        DEFAULT_TERMINALS.find((t) => t.id === cleanId || t.code === cleanId) || null,
      );
    },
    readLocalStorageFallback: () => {
      const cached = readTerminalsFromLocalStorage();
      if (!cached) return null;
      return validateScope(cached.find((t) => t.id === cleanId || t.code === cleanId) || null);
    },
    defaultFallback: validateScope(
      DEFAULT_TERMINALS.find((t) => t.id === cleanId || t.code === cleanId) || null,
    ),
  });

  return result.data;
}

/**
 * Registers a new POS terminal attached to a store branch and organization.
 */
export async function createTerminal(input: CreateTerminalInput): Promise<Terminal> {
  assertOrganizationAdminAccess(input.actor, 'terminal:create');
  const id = `term-${Date.now().toString(36)}`;
  const record: Terminal = {
    id,
    branchId: input.branchId.trim().slice(0, 128),
    ...(input.orgId ? { orgId: input.orgId.trim().slice(0, 128) } : {}),
    name: input.name.trim().slice(0, 120),
    code: input.code.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64),
    ...(input.deviceModel ? { deviceModel: input.deviceModel.trim().slice(0, 120) } : {}),
    ...(input.ipAddress ? { ipAddress: input.ipAddress.trim().slice(0, 64) } : {}),
    paperWidth: input.paperWidth || '80mm',
    status: input.status || 'active',
    createdAt: Date.now(),
  };

  try {
    await setDoc(doc(db, 'terminals', id), record);
    saveTerminalsToLocalStorage([record], true);
    void recordOrganizationAuditLog({
      entityType: 'terminal',
      entityId: record.id,
      action: 'create',
      entityName: record.name,
      orgId: record.orgId,
      branchId: record.branchId,
      actor: input.actor,
      newState: record as unknown as Record<string, unknown>,
      details: { code: record.code, deviceModel: record.deviceModel, paperWidth: record.paperWidth },
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `terminals/${id}`);
  }
}

/**
 * Updates a POS terminal's registration details in Firestore.
 */
export async function updateTerminal(
  terminalId: string,
  updates: UpdateTerminalInput,
): Promise<Terminal> {
  assertOrganizationAdminAccess(updates.actor, 'terminal:update');
  const existing = await getTerminalById(terminalId);
  if (!existing) {
    throw new Error(`Terminal with ID ${terminalId} not found.`);
  }

  const record: Terminal = {
    id: existing.id,
    branchId: existing.branchId,
    ...(existing.orgId || updates.orgId ? { orgId: (updates.orgId || existing.orgId)!.trim().slice(0, 128) } : {}),
    name: updates.name !== undefined ? updates.name.trim().slice(0, 120) : existing.name,
    code: updates.code !== undefined
      ? updates.code.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
      : existing.code,
    ...(updates.deviceModel !== undefined ? { deviceModel: updates.deviceModel.trim().slice(0, 120) } : existing.deviceModel ? { deviceModel: existing.deviceModel } : {}),
    ...(updates.ipAddress !== undefined ? { ipAddress: updates.ipAddress.trim().slice(0, 64) } : existing.ipAddress ? { ipAddress: existing.ipAddress } : {}),
    paperWidth: updates.paperWidth || existing.paperWidth || '80mm',
    status: updates.status || existing.status || 'active',
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  try {
    await withFirestoreTimeout(
      () => setDoc(doc(db, 'terminals', terminalId), record),
      `updateTerminal(${terminalId})`,
      configuredTimeoutMs,
    );
    saveTerminalsToLocalStorage([record], true);
    void recordOrganizationAuditLog({
      entityType: 'terminal',
      entityId: record.id,
      action: 'update',
      entityName: record.name,
      orgId: record.orgId,
      branchId: record.branchId,
      actor: updates.actor,
      previousState: existing as unknown as Record<string, unknown>,
      newState: record as unknown as Record<string, unknown>,
      details: updates as Record<string, unknown>,
    });
    return record;
  } catch (error) {
    const reason = classifyFirestoreFallbackReason(error);
    if (reason === 'timeout' || reason === 'simulated_timeout' || reason === 'network_error') {
      saveTerminalsToLocalStorage([record], true);
      firestoreSyncStatusService.enqueuePendingWrite({
        collection: 'terminals',
        documentId: terminalId,
        entityName: record.name,
        operation: 'update',
        localPayload: record as unknown as Record<string, unknown>,
        baseUpdatedAt: existing.updatedAt ?? existing.createdAt,
      });
      return record;
    }
    handleFirestoreError(error, OperationType.UPDATE, `terminals/${terminalId}`);
  }
}

/**
 * Deletes / de-registers a POS terminal from Firestore.
 */
export async function deleteTerminal(terminalId: string, actor?: OrganizationActorContext): Promise<void> {
  assertOrganizationAdminAccess(actor, 'terminal:delete');
  const existing = await getTerminalById(terminalId);
  try {
    await deleteDoc(doc(db, 'terminals', terminalId));
    const existingCache = readTerminalsFromLocalStorage();
    if (existingCache) {
      saveTerminalsToLocalStorage(existingCache.filter((t) => t.id !== terminalId), false);
    }
    void recordOrganizationAuditLog({
      entityType: 'terminal',
      entityId: terminalId,
      action: 'delete',
      entityName: existing?.name || terminalId,
      orgId: existing?.orgId,
      branchId: existing?.branchId,
      actor,
      previousState: (existing as unknown as Record<string, unknown>) || undefined,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `terminals/${terminalId}`);
  }
}

// ============================================================================
// 4. Unified Organization, Branch & Terminal Selection Flow Loader with Fallback
// ============================================================================

/**
 * Loads the complete Organization, Branch, and Terminal catalog for the POS login and
 * terminal selection flow with built-in Firestore connection timeout handling and
 * automatic localStorage fallback recovery.
 */
export async function getOrganizationSelectionCatalogWithFallback(options?: {
  organizationId?: string;
  branchId?: string;
  terminalId?: string;
  timeoutMs?: number;
  customFirestoreLoader?: () => Promise<{
    organizations: Organization[];
    branches: Branch[];
    terminals: Terminal[];
  }>;
}): Promise<OrganizationSelectionCatalogResult> {
  const startMs = Date.now();
  const timeoutMs = options?.timeoutMs ?? configuredTimeoutMs;
  const savedSelection = readSelectionScopeFromLocalStorage();

  const applyScopeFilters = (catalog: {
    organizations: Organization[];
    branches: Branch[];
    terminals: Terminal[];
  }) => {
    const branches = options?.organizationId
      ? catalog.branches.filter((b) => b.orgId === options.organizationId)
      : catalog.branches;
    const branchTerminals = options?.branchId
      ? catalog.terminals.filter((t) => {
          if (t.branchId !== options.branchId) return false;
          if (options.organizationId && t.orgId && t.orgId !== options.organizationId) return false;
          return true;
        })
      : catalog.terminals;
    const filteredTerminals = options?.terminalId
      ? branchTerminals.filter(
          (t) => t.id === options.terminalId || t.code === options.terminalId,
        )
      : branchTerminals;

    return {
      organizations: catalog.organizations,
      branches,
      terminals: filteredTerminals.length > 0 ? filteredTerminals : branchTerminals,
    };
  };

  try {
    const rawCatalog = await withFirestoreTimeout(
      async () => {
        if (options?.customFirestoreLoader) {
          return options.customFirestoreLoader();
        }
        const [orgSnap, branchSnap, termSnap] = await Promise.all([
          getDocs(collection(db, 'organizations')),
          getDocs(collection(db, 'branches')),
          getDocs(collection(db, 'terminals')),
        ]);

        let organizations = orgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
        let branches = branchSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Branch));
        let terminals = termSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Terminal));

        if (organizations.length === 0 && branches.length === 0 && terminals.length === 0) {
          await ensureDefaultOrganizations();
          organizations = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
          branches = readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
          terminals = readTerminalsFromLocalStorage() || DEFAULT_TERMINALS;
        } else {
          if (organizations.length === 0) organizations = DEFAULT_ORGS;
          if (branches.length === 0) branches = DEFAULT_BRANCHES;
          if (terminals.length === 0) terminals = DEFAULT_TERMINALS;
        }

        return { organizations, branches, terminals };
      },
      'getOrganizationSelectionCatalogWithFallback',
      timeoutMs,
    );

    const latencyMs = Math.max(1, Date.now() - startMs);

    // Persist fresh Firestore snapshot to localStorage for future offline/timeout recovery
    saveOrganizationsToLocalStorage(rawCatalog.organizations);
    saveBranchesToLocalStorage(rawCatalog.branches, false);
    saveTerminalsToLocalStorage(rawCatalog.terminals, false);

    const scoped = applyScopeFilters(rawCatalog);
    const meta = readCatalogCacheMetaFromLocalStorage();

    resilienceTelemetryState.lastSource = 'firestore';
    resilienceTelemetryState.degraded = false;
    resilienceTelemetryState.timedOut = false;
    resilienceTelemetryState.lastFallbackReason = undefined;
    resilienceTelemetryState.lastErrorMessage = undefined;
    resilienceTelemetryState.lastLatencyMs = latencyMs;
    resilienceTelemetryState.lastSyncedAt = Date.now();
    resilienceTelemetryState.consecutiveTimeouts = 0;
    notifyResilienceListeners();

    return {
      ...scoped,
      source: 'firestore',
      degraded: false,
      timedOut: false,
      latencyMs,
      cachedAt: meta?.updatedAt ?? Date.now(),
      savedSelection,
    };
  } catch (error) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const reason = classifyFirestoreFallbackReason(error);
    const timedOut = reason === 'timeout' || reason === 'simulated_timeout';
    const errorMessage = error instanceof Error ? error.message : String(error);

    const cachedOrgs = readOrganizationsFromLocalStorage();
    const cachedBranches = readBranchesFromLocalStorage();
    const cachedTerminals = readTerminalsFromLocalStorage();

    const hasLocalStorageCache = Boolean(
      cachedOrgs &&
        cachedOrgs.length > 0 &&
        cachedBranches &&
        cachedBranches.length > 0 &&
        cachedTerminals &&
        cachedTerminals.length > 0,
    );

    const resolvedSource: OrganizationCatalogSource = hasLocalStorageCache
      ? 'localStorage'
      : 'defaults';

    const fallbackCatalog = {
      organizations: cachedOrgs && cachedOrgs.length > 0 ? cachedOrgs : DEFAULT_ORGS,
      branches: cachedBranches && cachedBranches.length > 0 ? cachedBranches : DEFAULT_BRANCHES,
      terminals:
        cachedTerminals && cachedTerminals.length > 0 ? cachedTerminals : DEFAULT_TERMINALS,
    };

    if (!hasLocalStorageCache) {
      seedLocalStorageCatalogIfEmpty();
    }

    const scoped = applyScopeFilters(fallbackCatalog);
    const meta = readCatalogCacheMetaFromLocalStorage();

    resilienceTelemetryState.lastSource = resolvedSource;
    resilienceTelemetryState.degraded = true;
    resilienceTelemetryState.timedOut = timedOut;
    resilienceTelemetryState.lastFallbackReason = reason;
    resilienceTelemetryState.lastErrorMessage = errorMessage;
    resilienceTelemetryState.lastLatencyMs = latencyMs;
    resilienceTelemetryState.totalFallbacksTriggered += 1;
    if (timedOut) {
      resilienceTelemetryState.consecutiveTimeouts += 1;
    }
    notifyResilienceListeners();

    try {
      auditService.logDiagnosticEvent({
        level: timedOut ? 'WARN' : 'ERROR',
        category: 'network',
        event: timedOut ? 'FIRESTORE_SELECTION_TIMEOUT' : 'FIRESTORE_SELECTION_FALLBACK',
        deviceName: 'organizationService.getOrganizationSelectionCatalogWithFallback',
        message: `Firestore connection ${reason} (${latencyMs}ms). Selection flow switched to ${resolvedSource} fallback (${scoped.organizations.length} orgs, ${scoped.branches.length} branches, ${scoped.terminals.length} terminals).`,
        metadata: {
          source: resolvedSource,
          fallbackReason: reason,
          timedOut,
          latencyMs,
          timeoutThresholdMs: timeoutMs,
          errorMessage,
          orgCount: scoped.organizations.length,
          branchCount: scoped.branches.length,
          terminalCount: scoped.terminals.length,
        },
      });
    } catch {
      // Do not interrupt selection fallback flow
    }

    return {
      ...scoped,
      source: resolvedSource,
      degraded: true,
      timedOut,
      fallbackReason: reason,
      errorMessage,
      latencyMs,
      cachedAt: meta?.updatedAt ?? null,
      savedSelection,
    };
  }
}

// ============================================================================
// 5. Cascade Deletion Helpers
// ============================================================================

/**
 * Cascade-deletes a store branch and all terminals registered under it.
 */
export async function deleteBranchCascade(
  branchId: string,
  orgId?: string,
): Promise<{ terminalsDeleted: number }> {
  const branch = await getBranchById(branchId, orgId);
  const terminals = await getTerminalsByBranch(branchId, orgId);
  for (const term of terminals) {
    await deleteTerminal(term.id);
  }
  await deleteBranch(branchId);
  void recordOrganizationAuditLog({
    entityType: 'branch',
    entityId: branchId,
    action: 'cascade_delete',
    entityName: branch?.name || branchId,
    orgId: branch?.orgId || orgId,
    branchId,
    details: { terminalsDeleted: terminals.length },
  });
  return { terminalsDeleted: terminals.length };
}

/**
 * Cascade-deletes an entire organization, all child branches, and all child terminals.
 */
export async function deleteOrganizationCascade(
  orgId: string,
): Promise<{ branchesDeleted: number; terminalsDeleted: number }> {
  const org = await getOrganizationById(orgId);
  const branches = await getBranchesByOrg(orgId);
  let totalTerminalsDeleted = 0;
  for (const branch of branches) {
    const res = await deleteBranchCascade(branch.id, orgId);
    totalTerminalsDeleted += res.terminalsDeleted;
  }
  await deleteOrganization(orgId);
  void recordOrganizationAuditLog({
    entityType: 'organization',
    entityId: orgId,
    action: 'cascade_delete',
    entityName: org?.name || orgId,
    orgId,
    details: { branchesDeleted: branches.length, terminalsDeleted: totalTerminalsDeleted },
  });
  return { branchesDeleted: branches.length, terminalsDeleted: totalTerminalsDeleted };
}

// ============================================================================
// 6. System Hierarchy & Composite Tree Queries
// ============================================================================

/**
 * Retrieves a complete organizational hierarchy tree (Organizations -> Branches -> Terminals)
 * suitable for dashboards, organizational charts, and multi-store administration.
 */
export async function getOrganizationHierarchy(targetOrgId?: string): Promise<OrganizationHierarchyNode[]> {
  const allOrgs = await getOrganizations();
  const selectedOrgs = targetOrgId ? allOrgs.filter((o) => o.id === targetOrgId) : allOrgs;

  const result: OrganizationHierarchyNode[] = [];

  for (const org of selectedOrgs) {
    const orgBranches = await getBranchesByOrg(org.id);
    const branchesWithTerminals: BranchWithTerminals[] = [];
    let orgTerminalCount = 0;

    for (const br of orgBranches) {
      const branchTerminals = await getTerminalsByBranch(br.id, org.id);
      branchesWithTerminals.push({
        ...br,
        terminals: branchTerminals,
      });
      orgTerminalCount += branchTerminals.length;
    }

    result.push({
      ...org,
      branches: branchesWithTerminals,
      totalTerminals: orgTerminalCount,
    });
  }

  return result;
}

// ============================================================================
// 7. Real-Time Listeners (onSnapshot Subscriptions with LocalStorage Fallback)
// ============================================================================

export interface OrganizationStructureSubscriptionOptions {
  targetOrgId?: string;
  onError?: (error: unknown) => void;
}

/**
 * Real-time listener for the complete organization structure (Organizations -> Branches -> Terminals)
 * or a specific organization's hierarchical subtree.
 *
 * Uses Firestore onSnapshot listeners on organizations, branches, and terminals collections to
 * provide immediate live updates whenever entities are added, updated, or removed.
 * Automatically persists snapshots to localStorage and falls back to localStorage on listener errors.
 */
export function subscribeToOrganizationStructure(
  callback: (nodes: OrganizationHierarchyNode[]) => void,
  options?: OrganizationStructureSubscriptionOptions,
): Unsubscribe {
  let orgList: Organization[] = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
  let branchList: Branch[] = readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
  let terminalList: Terminal[] = readTerminalsFromLocalStorage() || DEFAULT_TERMINALS;

  const emitHierarchy = () => {
    const targetOrgId = options?.targetOrgId?.trim();
    const sourceOrgs = targetOrgId
      ? orgList.filter((o) => o.id === targetOrgId)
      : orgList;

    const hierarchy: OrganizationHierarchyNode[] = sourceOrgs.map((org) => {
      const orgBranches = branchList.filter((b) => b.orgId === org.id);
      let totalTerminals = 0;

      const branchesWithTerminals: BranchWithTerminals[] = orgBranches.map((br) => {
        const branchTerms = terminalList.filter((t) => t.branchId === br.id);
        totalTerminals += branchTerms.length;
        return {
          ...br,
          terminals: branchTerms,
        };
      });

      return {
        ...org,
        branches: branchesWithTerminals,
        totalTerminals,
      };
    });

    callback(hierarchy);
  };

  const handleListenerError = (err: unknown, entity: string) => {
    console.warn(`[Firestore Realtime] Error listening to ${entity}, serving localStorage fallback:`, err);
    orgList = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
    branchList = readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
    terminalList = readTerminalsFromLocalStorage() || DEFAULT_TERMINALS;
    emitHierarchy();
    if (options?.onError) {
      options.onError(err);
    }
  };

  // 1. Real-time Organizations listener
  const unsubOrgs = onSnapshot(
    collection(db, 'organizations'),
    (snapshot) => {
      if (snapshot.empty) {
        orgList = readOrganizationsFromLocalStorage() || DEFAULT_ORGS;
        void ensureDefaultOrganizations();
      } else {
        orgList = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Organization));
        saveOrganizationsToLocalStorage(orgList);
      }
      emitHierarchy();
    },
    (err) => handleListenerError(err, 'organizations'),
  );

  // 2. Real-time Branches listener
  const branchesQuery = options?.targetOrgId
    ? query(collection(db, 'branches'), where('orgId', '==', options.targetOrgId.trim()))
    : collection(db, 'branches');

  const unsubBranches = onSnapshot(
    branchesQuery,
    (snapshot) => {
      if (snapshot.empty) {
        branchList = options?.targetOrgId
          ? readBranchesFromLocalStorage(options.targetOrgId) ||
            DEFAULT_BRANCHES.filter((b) => b.orgId === options.targetOrgId)
          : readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
      } else {
        branchList = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Branch));
        saveBranchesToLocalStorage(branchList, Boolean(options?.targetOrgId));
      }
      emitHierarchy();
    },
    (err) => handleListenerError(err, 'branches'),
  );

  // 3. Real-time Terminals listener
  const terminalsQuery = collection(db, 'terminals');

  const unsubTerminals = onSnapshot(
    terminalsQuery,
    (snapshot) => {
      if (snapshot.empty) {
        terminalList = readTerminalsFromLocalStorage() || DEFAULT_TERMINALS;
      } else {
        terminalList = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Terminal));
        saveTerminalsToLocalStorage(terminalList, false);
      }
      emitHierarchy();
    },
    (err) => handleListenerError(err, 'terminals'),
  );

  return () => {
    unsubOrgs();
    unsubBranches();
    unsubTerminals();
  };
}

/**
 * Real-time listener for registered organizations collection with localStorage fallback.
 */
export function subscribeToOrganizations(
  callback: (orgs: Organization[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'organizations'),
    (snapshot) => {
      if (snapshot.empty) {
        void ensureDefaultOrganizations();
        callback(readOrganizationsFromLocalStorage() || DEFAULT_ORGS);
      } else {
        const orgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
        saveOrganizationsToLocalStorage(orgs);
        callback(orgs);
      }
    },
    (err) => {
      callback(readOrganizationsFromLocalStorage() || DEFAULT_ORGS);
      if (onError) onError(err);
    },
  );
}

/**
 * Real-time listener for store branches, optionally scoped to an organization, with localStorage fallback.
 */
export function subscribeToBranches(
  orgId?: string,
  callback?: (branches: Branch[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const handler = callback || (() => {});
  const q = orgId && orgId.trim()
    ? query(collection(db, 'branches'), where('orgId', '==', orgId.trim()))
    : collection(db, 'branches');

  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        const fallbacks = orgId
          ? readBranchesFromLocalStorage(orgId.trim()) ||
            DEFAULT_BRANCHES.filter((b) => b.orgId === orgId.trim())
          : readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
        handler(fallbacks);
      } else {
        const branches = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Branch));
        saveBranchesToLocalStorage(branches, Boolean(orgId));
        handler(branches);
      }
    },
    (err) => {
      const fallbacks = orgId
        ? readBranchesFromLocalStorage(orgId.trim()) ||
          DEFAULT_BRANCHES.filter((b) => b.orgId === orgId.trim())
        : readBranchesFromLocalStorage() || DEFAULT_BRANCHES;
      handler(fallbacks);
      if (onError) onError(err);
    },
  );
}

/**
 * Real-time listener for POS terminals, optionally scoped to a store branch and organization, with localStorage fallback.
 */
export function subscribeToTerminals(
  branchId?: string,
  orgId?: string,
  callback?: (terminals: Terminal[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const handler = callback || (() => {});
  const q = branchId && branchId.trim()
    ? query(collection(db, 'terminals'), where('branchId', '==', branchId.trim()))
    : collection(db, 'terminals');

  const resolveLocalFallbacks = () => {
    const cached = readTerminalsFromLocalStorage(branchId, orgId);
    if (cached && cached.length > 0) return cached;
    return DEFAULT_TERMINALS.filter((t) => {
      if (branchId && t.branchId !== branchId.trim()) return false;
      if (orgId && t.orgId && t.orgId !== orgId.trim()) return false;
      return true;
    });
  };

  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        handler(resolveLocalFallbacks());
      } else {
        let terminals = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Terminal));
        saveTerminalsToLocalStorage(terminals, Boolean(branchId));
        if (orgId && orgId.trim()) {
          terminals = terminals.filter((t) => !t.orgId || t.orgId === orgId.trim());
        }
        handler(terminals);
      }
    },
    (err) => {
      handler(resolveLocalFallbacks());
      if (onError) onError(err);
    },
  );
}

// ============================================================================
// 8. Real-Time Audit Logs Listeners
// ============================================================================

/**
 * Real-time listener for audit_logs collection in Firestore.
 * Automatically receives live updates whenever a CRUD action occurs on Organizations, Branches, or Terminals.
 */
export function subscribeToAuditLogs(
  callback: (logs: OrganizationAuditLog[]) => void,
  options?: {
    entityType?: 'organization' | 'branch' | 'terminal';
    action?: 'create' | 'update' | 'delete' | 'cascade_delete';
    orgId?: string;
    limitCount?: number;
    onError?: (error: unknown) => void;
  },
): Unsubscribe {
  const maxLogs = options?.limitCount || 100;

  const q = options?.entityType
    ? query(collection(db, 'audit_logs'), where('entityType', '==', options.entityType))
    : collection(db, 'audit_logs');

  return onSnapshot(
    q,
    (snapshot) => {
      let logs = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as OrganizationAuditLog));

      if (options?.action) {
        logs = logs.filter((l) => l.action === options.action);
      }
      if (options?.orgId && options.orgId.trim()) {
        logs = logs.filter((l) => l.orgId === options.orgId);
      }

      logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      callback(logs.slice(0, maxLogs));
    },
    (err) => {
      console.warn('[AuditLog] Realtime listener error:', err);
      if (options?.onError) {
        options.onError(err);
      }
    },
  );
}

/**
 * Fetches audit logs from Firestore.
 */
export async function getAuditLogs(
  options?: {
    entityType?: 'organization' | 'branch' | 'terminal';
    action?: 'create' | 'update' | 'delete' | 'cascade_delete';
    orgId?: string;
    limitCount?: number;
  },
): Promise<OrganizationAuditLog[]> {
  const maxLogs = options?.limitCount || 100;
  try {
    const q = options?.entityType
      ? query(collection(db, 'audit_logs'), where('entityType', '==', options.entityType))
      : collection(db, 'audit_logs');
    const snapshot = await withFirestoreTimeout(
      () => getDocs(q),
      'getAuditLogs',
      configuredTimeoutMs,
    );
    let logs = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    } as OrganizationAuditLog));

    if (options?.action) {
      logs = logs.filter((l) => l.action === options.action);
    }
    if (options?.orgId && options.orgId.trim()) {
      logs = logs.filter((l) => l.orgId === options.orgId);
    }

    logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return logs.slice(0, maxLogs);
  } catch (err) {
    console.warn('[AuditLog] getAuditLogs error:', err);
    return [];
  }
}

// Aliases for compatibility
export const subscribeToOrganizationHierarchy = subscribeToOrganizationStructure;
export const getBranches = getAllBranches;
export const getTerminals = getAllTerminals;
