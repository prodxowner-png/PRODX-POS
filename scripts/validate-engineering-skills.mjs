#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export function validateSkills(root) {
  const skillsDir = path.join(root, '.agents', 'skills');
  const indexPath = path.join(skillsDir, 'README.md');
  const errors = [];

  if (!fs.existsSync(indexPath)) {
    return ['Missing .agents/skills/README.md'];
  }

  const index = fs.readFileSync(indexPath, 'utf8');
  const linkedSkills = new Set(
    [...index.matchAll(/\]\(([^)]+\/SKILL\.md)\)/g)].map((match) => match[1]),
  );

  const directories = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of directories) {
    const relativeSkillPath = `${name}/SKILL.md`;
    const skillPath = path.join(skillsDir, name, 'SKILL.md');

    if (!fs.existsSync(skillPath)) {
      errors.push(`${relativeSkillPath}: missing SKILL.md`);
      continue;
    }
    if (!linkedSkills.has(relativeSkillPath)) {
      errors.push(`${relativeSkillPath}: missing link in skill index`);
    }

    const content = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatter) {
      errors.push(`${relativeSkillPath}: missing YAML frontmatter`);
      continue;
    }

    const declaredName = frontmatter[1].match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (declaredName !== name) {
      errors.push(`${relativeSkillPath}: frontmatter name must equal directory name (${name})`);
    }
    if (!description) {
      errors.push(`${relativeSkillPath}: missing non-empty description`);
    }
    const hasEvidenceContract = /^## Evidence contract$/m.test(content);
    const hasReviewOutputContract = /^## Output Contract$/m.test(content);
    if (!hasEvidenceContract && !hasReviewOutputContract) {
      errors.push(`${relativeSkillPath}: missing Evidence contract or review Output Contract section`);
    }
    if (hasEvidenceContract && !/\b(PASS|FAIL|BLOCKED|UNVERIFIED)\b/.test(content)) {
      errors.push(`${relativeSkillPath}: evidence contract is missing required status vocabulary`);
    }
  }

  for (const link of linkedSkills) {
    if (!fs.existsSync(path.join(skillsDir, link))) {
      errors.push(`${link}: index link target does not exist`);
    }
  }

  return errors;
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1] ?? '.') : process.cwd();
  const errors = validateSkills(root);

  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: all engineering skills have valid metadata, evidence contracts, and index links.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
