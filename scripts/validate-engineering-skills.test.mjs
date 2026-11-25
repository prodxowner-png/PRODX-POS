import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSkills } from './validate-engineering-skills.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prodx-skills-'));
  const skillDir = path.join(root, '.agents', 'skills', 'sample-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'skills', 'README.md'),
    '# Skills\n- [sample-skill](sample-skill/SKILL.md)\n',
  );
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: sample-skill\ndescription: A test skill.\n---\n\n## Evidence contract\nPASS FAIL BLOCKED UNVERIFIED\n',
  );
  return root;
}

test('accepts a skill with matching metadata, evidence contract, and index link', () => {
  const root = fixture();
  try {
    assert.deepEqual(validateSkills(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a mismatched skill name and missing index link', () => {
  const root = fixture();
  try {
    const skill = path.join(root, '.agents', 'skills', 'sample-skill', 'SKILL.md');
    const index = path.join(root, '.agents', 'skills', 'README.md');
    fs.writeFileSync(index, '# Skills\n');
    fs.writeFileSync(skill, '---\nname: wrong-name\ndescription: A test skill.\n---\n\n## Evidence contract\nPASS FAIL BLOCKED UNVERIFIED\n');
    const errors = validateSkills(root);
    assert.ok(errors.some((error) => error.includes('frontmatter name must equal directory name')));
    assert.ok(errors.some((error) => error.includes('missing link in skill index')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an index link whose target does not exist', () => {
  const root = fixture();
  try {
    const index = path.join(root, '.agents', 'skills', 'README.md');
    fs.appendFileSync(index, '- [missing](missing/SKILL.md)\n');
    assert.ok(validateSkills(root).some((error) => error.includes('index link target does not exist')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
