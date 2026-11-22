import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

test('server.ts does not statically import dev-only vite at top level', () => {
  assert.equal(
    /^\s*import\b[^;\n]*['"]vite['"]/m.test(serverSource),
    false,
    'server.ts must not contain a top-level static import from "vite" so --omit=dev production builds can start',
  );
});

test('server.ts loads vite dynamically only inside the non-production branch', () => {
  assert.match(
    serverSource,
    /if\s*\(\s*!isProd\s*\)\s*\{[\s\S]*?await\s+import\(\s*['"]vite['"]\s*\)/,
    'server.ts must dynamically import "vite" inside if (!isProd)',
  );
});
