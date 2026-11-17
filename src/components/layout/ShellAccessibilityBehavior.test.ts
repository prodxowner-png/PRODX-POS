import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('AppShell: mobile quick navigation provides semantic active page and visible focus', () => {
  const source = readSource('./AppShell.tsx');

  // Landmark and accessible label
  assert.match(source, /aria-label="Mobile Quick Navigation"/);

  // Active navigation semantics
  assert.match(source, /aria-current=\{active \? 'page' : undefined\}/);

  // Touch target >= 44px
  assert.match(source, /min-h-\[44px\]/);

  // Focus visible ring
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-primary\/40/);
});

test('Sidebar: announces active page via aria-current and defines visible keyboard focus', () => {
  const source = readSource('./Sidebar.tsx');

  // Semantic active page
  assert.match(source, /aria-current=\{isActive \? 'page' : undefined\}/);

  // Focus visible outline and ring
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /focus-visible:outline-none/);

  // Navigation landmark
  assert.match(source, /<nav/);
});

test('TopNav: search shortcut, mobile menu trigger, and action buttons have accessible names', () => {
  const source = readSource('./TopNav.tsx');

  // Mobile drawer trigger
  assert.match(source, /aria-label="Open navigation menu"/);

  // Command palette shortcut trigger
  assert.match(source, /aria-label="Search Products, Customers, Orders \(Ctrl\+K\)"/);

  // Minimum 44px touch targets on interactive controls
  assert.match(source, /min-h-\[44px\]/);
});

test('StatusBar: semantic footer landmark and explicit status labels for offline/sync and RBAC', () => {
  const source = readSource('./StatusBar.tsx');

  // Semantic footer
  assert.match(source, /<footer/);

  // RBAC indicator
  assert.match(source, /ROLE:/);

  // Sync / outbox connection status label
  assert.match(source, /isOnline \? 'LIVE' : 'OFFLINE'/);
  assert.match(source, /OUTBOX:/);
});

test('OfflineBanner: status announcement and distinct states for disconnected vs pending sync', () => {
  const source = readSource('./OfflineBanner.tsx');

  // Polite live region
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);

  // Semantic warning styling
  assert.match(source, /bg-warning-subtle/);
  assert.match(source, /border-warning\/30/);

  // Disconnected state
  assert.match(source, /!isOnline/);
  assert.match(source, /Offline Mode Active:/);

  // Pending sync state
  assert.match(source, /pendingCount > 0/);
  assert.match(source, /Pending Synchronization:/);
});
