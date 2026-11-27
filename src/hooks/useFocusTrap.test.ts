import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createFocusTrapStack, resolveFocusTrapKeyDown } from './useFocusTrap';

test('useFocusTrap keyboard resolver wraps Tab/Shift+Tab, recovers outside focus, and handles Escape', () => {
  const controls = ['close-btn', 'input-field', 'submit-btn'] as const;

  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Escape',
      shiftKey: false,
      hasOnEscape: true,
      focusable: controls,
      activeElement: 'input-field',
      activeInsideContainer: true,
    }),
    { type: 'escape' },
  );

  // Forward Tab on last element wraps to first
  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Tab',
      shiftKey: false,
      hasOnEscape: true,
      focusable: controls,
      activeElement: 'submit-btn',
      activeInsideContainer: true,
    }),
    { type: 'focus-target', target: 'close-btn' },
  );

  // Backward Shift+Tab on first element wraps to last
  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Tab',
      shiftKey: true,
      hasOnEscape: true,
      focusable: controls,
      activeElement: 'close-btn',
      activeInsideContainer: true,
    }),
    { type: 'focus-target', target: 'submit-btn' },
  );

  // Middle element allows native sequential navigation
  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Tab',
      shiftKey: false,
      hasOnEscape: true,
      focusable: controls,
      activeElement: 'input-field',
      activeInsideContainer: true,
    }),
    { type: 'allow' },
  );

  // Focus outside dialog is pulled back inside
  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Tab',
      shiftKey: false,
      hasOnEscape: true,
      focusable: controls,
      activeElement: null,
      activeInsideContainer: false,
    }),
    { type: 'focus-target', target: 'close-btn' },
  );

  // Empty focusable dialog focuses the container itself
  assert.deepEqual(
    resolveFocusTrapKeyDown({
      key: 'Tab',
      shiftKey: false,
      hasOnEscape: true,
      focusable: [],
      activeElement: null,
      activeInsideContainer: true,
    }),
    { type: 'focus-container' },
  );
});

test('Drawer provides accessible modal dialog semantics and focus-trap wiring', () => {
  const drawerSrc = fs.readFileSync(path.resolve('src/components/common/Drawer.tsx'), 'utf8');

  assert.match(drawerSrc, /useFocusTrap\(drawerRef,\s*\{[\s\S]*returnFocus:\s*true[\s\S]*onEscape:\s*onClose/);
  assert.match(drawerSrc, /role="dialog"/);
  assert.match(drawerSrc, /aria-modal="true"/);
  assert.match(drawerSrc, /aria-labelledby=\{titleId\}/);
  assert.match(drawerSrc, /aria-label=\{closeLabel\}/);
  assert.match(drawerSrc, /min-h-\[44px\]\s+min-w-\[44px\]/);
});

test('nested focus traps allow only the topmost active trap to handle Escape', () => {
  const stack = createFocusTrapStack<string>();
  stack.push('outer-modal');
  assert.equal(stack.isTopmost('outer-modal'), true);

  stack.push('inner-confirm');
  assert.equal(stack.isTopmost('outer-modal'), false);
  assert.equal(stack.isTopmost('inner-confirm'), true);

  // Closing the inner trap restores Escape/Tab ownership to the outer trap
  stack.remove('inner-confirm');
  assert.equal(stack.isTopmost('outer-modal'), true);
  assert.equal(stack.size(), 1);

  // Out-of-order removal preserves the remaining topmost trap
  stack.push('nested-drawer');
  stack.remove('outer-modal');
  assert.equal(stack.isTopmost('nested-drawer'), true);
  assert.equal(stack.size(), 1);

  // Source contract: useFocusTrap checks topmost ownership and stops immediate propagation on Escape
  const hookSrc = fs.readFileSync(path.resolve('src/hooks/useFocusTrap.ts'), 'utf8');
  assert.match(hookSrc, /if\s*\(!activeFocusTrapStack\.isTopmost\(trapId\)\)\s*\{\s*return;\s*\}/);
  assert.match(hookSrc, /e\.stopImmediatePropagation\(\)/);
});
