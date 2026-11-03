import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { buildCommand?: string; outputDirectory?: string };
const apiEntrypoint = fs.readFileSync(path.join(root, 'api/index.ts'), 'utf8');

test('Vercel build emits the server bundle required by the API entrypoint', () => {
  assert.match(apiEntrypoint, /from ['"]\.\.\/server-bundle\.js['"]/);
  assert.match(vercel.buildCommand ?? '', /bun build \.\/server\/entrypoint\.ts --outfile \.\/server-bundle\.js/);
  assert.equal(vercel.outputDirectory, 'dist');
});
