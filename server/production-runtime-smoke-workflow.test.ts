import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.join(process.cwd(), '.github/workflows/production-runtime-smoke.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const triggerBlock = workflow.split(/^permissions:\s*$/m, 1)[0];

test('Production Runtime Smoke monitors production only on main pushes, schedule, or manual dispatch', () => {
  assert.match(triggerBlock, /^\s{2}push:\s*$/m);
  assert.match(triggerBlock, /^\s{4}branches:\s*\[main\]\s*$/m);
  assert.match(triggerBlock, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(triggerBlock, /^\s{2}schedule:\s*$/m);
  assert.doesNotMatch(
    triggerBlock,
    /^\s{2}pull_request:\s*$/m,
    'live-production readiness must not be used as a candidate-PR gate',
  );
});

test('Production Runtime Smoke keeps liveness, readiness, and frontend assertions against the production alias', () => {
  assert.match(workflow, /https:\/\/prodx-pos\.vercel\.app\/api\/v1\/healthz/);
  assert.match(workflow, /https:\/\/prodx-pos\.vercel\.app\/api\/v1\/readyz/);
  assert.match(workflow, /https:\/\/prodx-pos\.vercel\.app\//);
  assert.match(workflow, /status["'][^\n]*ready/);
  assert.match(workflow, /Publish smoke evidence/);
});
