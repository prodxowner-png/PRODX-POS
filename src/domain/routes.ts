/**
 * PRODX POS — Centralized Navigation & Console Routing Types
 * Extracted to prevent circular dependencies between security middleware and UI components.
 */

export type NavRoute =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'inventory'
  | 'customers'
  | 'shift'
  | 'audit'
  | 'settings'
  | 'kitchen'
  | 'kds'
  | 'tasks'
  | 'infrastructure'
  | 'admin';

export type AdminConsoleSection =
  | 'overview'
  | 'organizations'
  | 'branches'
  | 'terminals'
  | 'rbac'
  | 'assignments'
  | 'permissions'
  | 'sync_monitor'
  | 'security_audit'
  | 'audit'
  | 'infrastructure'
  | 'bundle_trends';
