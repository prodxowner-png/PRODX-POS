import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import test from 'node:test';
import { privateBuildArtifactGuard } from './private-build-artifact-guard.ts';

const start = async (app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

test('production build-directory fallback never serves private diagnostics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'prodx-private-build-'));
  const buildDir = path.join(root, 'build');
  await mkdir(path.join(buildDir, 'diagnostics'), { recursive: true });
  await writeFile(path.join(buildDir, 'index.html'), '<h1>POS</h1>');
  await writeFile(path.join(buildDir, 'diagnostics', 'stats.html'), '<h1>private stats</h1>');
  await writeFile(path.join(buildDir, 'diagnostics', 'metafile.json'), '{"private":true}');
  await writeFile(path.join(buildDir, 'stats.html'), '<h1>private root stats</h1>');
  await writeFile(path.join(buildDir, 'metafile.json'), '{"privateRoot":true}');
  await writeFile(path.join(buildDir, 'server-bundle.js'), '/* private server bundle */');

  const app = express();
  // Mirrors server.ts production ordering when dist/ is absent and build/ is served.
  app.use(privateBuildArtifactGuard);
  app.use(express.static(buildDir));
  const server = await start(app);

  try {
    for (const pathname of [
      '/diagnostics/stats.html',
      '/diagnostics/metafile.json',
      '/stats.html',
      '/metafile.json',
      '/server-bundle.js',
      '/%64iagnostics/stats.html',
    ]) {
      const response = await fetch(`${server.baseUrl}${pathname}`);
      assert.equal(response.status, 404, `${pathname} must not be public`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }

    const publicPage = await fetch(`${server.baseUrl}/index.html`);
    assert.equal(publicPage.status, 200);
    assert.equal(await publicPage.text(), '<h1>POS</h1>');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
