import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Regression guard: the development mock auth adapter must never log credentials or
// direct identifiers (email / PIN / password) to the console.
const source = readFileSync(join(process.cwd(), 'src', 'adapters', 'mockAdapter.ts'), 'utf8');

test('mock auth adapter does not log the submitted password or PIN', () => {
  assert.doesNotMatch(source, /passwordOrPin:\s*passOrPin/);
  assert.doesNotMatch(source, /console\.\w+\([^)]*passOrPin/);
});

test('mock auth adapter does not log the submitted email or PIN identifier', () => {
  assert.doesNotMatch(source, /emailOrPin:\s*term/);
  assert.doesNotMatch(source, /Forgot PIN requested for:`,\s*\{[^}]*\bemailOrPin\b\s*[,}]/);
});
