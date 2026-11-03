/**
 * PRODX POS — Shared Storage Adapter Interface
 * Extracted to prevent circular dependencies between organizationService and firestoreSyncStatusService.
 */

export interface KeyValueStorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
