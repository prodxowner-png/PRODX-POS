import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

test('OfflineBanner exposes a polite status and uses semantic warning tokens', () => {
  const source = readSource('./OfflineBanner.tsx');
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /bg-warning-subtle/);
  assert.match(source, /border-warning\/30/);
  assert.doesNotMatch(source, /bg-amber-|text-amber-|border-amber-/);
});

test('OfflineBanner distinguishes offline state from queued synchronization', () => {
  const source = readSource('./OfflineBanner.tsx');
  assert.match(source, /!isOnline \? \(/);
  assert.match(source, /<WifiOff/);
  assert.match(source, /<RefreshCw/);
  assert.match(source, /pendingCount > 0/);
  assert.match(source, /triggerSync\(\)/);
});

test('Sidebar navigation announces the active page and has visible keyboard focus', () => {
  const source = readSource('./Sidebar.tsx');
  assert.match(source, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(source, /focus-visible:ring-2/);
});

test('shared shell components consume mapped Forest Luxury semantic color utilities', () => {
  const css = readSource('../../index.css');
  for (const token of [
    '--color-brand-bg: var(--brand-bg)',
    '--color-brand-surface: var(--brand-surface)',
    '--color-brand-text: var(--brand-text)',
    '--color-cta: var(--brand-cta)',
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
