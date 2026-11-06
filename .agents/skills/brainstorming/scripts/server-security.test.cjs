const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { isLoopbackHost, shellQuote } = require('./server.cjs');

test('only loopback addresses are accepted for the plaintext companion server', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.2', 'example.com', '127.0.0.999']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('custom browser launcher URL is shell-quoted as one literal argument', () => {
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-shell-quote-'));
  const marker = path.join(markerDir, 'injected');
  const url = `http://localhost:1234/?key=$(touch ${marker}); echo pwned`;
  const command = `printf '%s' ${shellQuote(url)}`;
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, url);
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(markerDir, { recursive: true, force: true });
});

test('server refuses a non-loopback HTTP bind before creating session files', () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-remote-bind-'));
  const serverPath = path.join(__dirname, 'server.cjs');
  const result = spawnSync(process.execPath, [serverPath], {
    encoding: 'utf8',
    env: { ...process.env, BRAINSTORM_HOST: '0.0.0.0', BRAINSTORM_DIR: sessionDir }
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Refusing non-loopback HTTP bind/);
  assert.equal(fs.existsSync(path.join(sessionDir, 'content')), false);
  fs.rmSync(sessionDir, { recursive: true, force: true });
});
