import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-graphs-test-'));
  const skillDir = path.join(root, 'sample-skill');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(skillDir);
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Sample\n\n```dot\ndigraph Broken { A -> B }\n```\n');
  const dot = path.join(binDir, 'dot');
  fs.writeFileSync(dot, '#!/bin/sh\nif [ "$1" = "-V" ]; then exit 0; fi\necho "synthetic Graphviz failure" >&2\nexit 1\n');
  fs.chmodSync(dot, 0o755);
  return { root, skillDir, binDir };
}

test('individual graph render failures produce a non-zero exit code', () => {
  const f = fixture();
  const script = path.join(process.cwd(), '.agents/skills/writing-skills/render-graphs.js');
  const result = spawnSync(process.execPath, [script, f.skillDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: f.binDir + path.delimiter + process.env.PATH }
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Failed: Broken/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('combined graph render failures produce a non-zero exit code', () => {
  const f = fixture();
  const script = path.join(process.cwd(), '.agents/skills/writing-skills/render-graphs.js');
  const result = spawnSync(process.execPath, [script, f.skillDir, '--combine'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: f.binDir + path.delimiter + process.env.PATH }
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Failed to render combined diagram/);
  fs.rmSync(f.root, { recursive: true, force: true });
});
