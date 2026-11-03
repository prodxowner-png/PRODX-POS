import fs from 'node:fs';
import path from 'node:path';

export interface ThemeRule {
  id: string;
  category: 'background' | 'border' | 'text' | 'accent' | 'spacing';
  description: string;
  match: RegExp;
  replacement: string;
}

export interface ValidationViolation {
  file: string;
  line: number;
  ruleId: string;
  category: string;
  matched: string;
  replacement: string;
}

export interface ValidationSummary {
  filesScanned: number;
  filesModified: number;
  totalViolations: number;
  violationsByCategory: Record<string, number>;
  violations: ValidationViolation[];
}

/**
 * Standard Theme Conversion Rules mapped to semantic tokens defined in index.css:
 * - Backgrounds: bg-card, bg-background, bg-primary
 * - Borders: border-border, border-crisp
 * - Typography: text-text, text-text/80, text-text/70, text-text/60, text-text/40
 * - Focus & Accents: focus:border-primary, focus:ring-primary, text-primary, bg-primary
 */
export const THEME_RULES: ThemeRule[] = [
  // 1. Dual-theme Background Containers -> bg-card
  {
    id: 'bg-dual-card-hardcoded-hex-generic',
    category: 'background',
    description: 'Convert hardcoded light/dark card background with arbitrary hex to semantic bg-card',
    match: /\bbg-white\s+dark:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'bg-card',
  },
  {
    id: 'bg-dual-card-zinc-soft-hex',
    category: 'background',
    description: 'Convert soft zinc light and dark hex background to semantic bg-card',
    match: /\bbg-(?:zinc|slate)-50\s+dark:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'bg-card',
  },
  {
    id: 'bg-dual-card-hardcoded-hex-opacity',
    category: 'background',
    description: 'Convert hardcoded light/dark card with opacity to semantic bg-card with opacity',
    match: /\bbg-white\/80\s+dark:bg-\[#[0-9A-Fa-f]{6}\]\/80/g,
    replacement: 'bg-card/80',
  },
  {
    id: 'bg-dual-card-zinc-slate',
    category: 'background',
    description: 'Convert hardcoded white/zinc/slate card backgrounds to bg-card',
    match: /\bbg-white\s+dark:bg-(?:zinc|slate)-(?:900|800)\b/g,
    replacement: 'bg-card',
  },
  {
    id: 'bg-dual-card-tinted',
    category: 'background',
    description: 'Convert tinted neutral card backgrounds to bg-card',
    match: /\bbg-(?:zinc|slate)-50\/70\s+dark:bg-\[#[0-9A-Fa-f]{6}\]\/70/g,
    replacement: 'bg-card',
  },
  {
    id: 'bg-dual-card-soft',
    category: 'background',
    description: 'Convert soft slate/zinc backgrounds to bg-card',
    match: /\bbg-(?:zinc|slate)-50\s+dark:bg-(?:zinc|slate)-900\/60/g,
    replacement: 'bg-card',
  },

  // 2. Base Backgrounds -> bg-background
  {
    id: 'bg-dual-workspace-background',
    category: 'background',
    description: 'Convert hardcoded outer canvas background to bg-background',
    match: /\bbg-(?:zinc|slate)-100(?:\/60)?\s+dark:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'bg-background',
  },
  {
    id: 'bg-dual-neutral-background',
    category: 'background',
    description: 'Convert hardcoded neutral pair background to bg-background',
    match: /\bbg-(?:zinc|slate)-(?:50|100)\s+dark:bg-(?:zinc|slate)-(?:800|900)\b/g,
    replacement: 'bg-background',
  },
  {
    id: 'bg-outer-portal-background',
    category: 'background',
    description: 'Convert portal/full page background to bg-background',
    match: /\bbg-zinc-50\s+dark:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'bg-background',
  },

  // 3. Borders -> border-border (and add border-crisp for 1px definition)
  {
    id: 'border-dual-zinc-white-hex',
    category: 'border',
    description: 'Convert hardcoded zinc/white-alpha borders to border-border border-crisp',
    match: /\bborder-(?:zinc|slate)-(?:100|200)(?:\/80)?\s+dark:border-white\/(?:2|5|8|10)\b/g,
    replacement: 'border-border border-crisp',
  },
  {
    id: 'border-dual-zinc-slate',
    category: 'border',
    description: 'Convert hardcoded dual-mode zinc/slate borders to border-border border-crisp',
    match: /\bborder-(?:zinc|slate)-(?:200|300)\s+dark:border-(?:zinc|slate)-(?:700|800)\b/g,
    replacement: 'border-border border-crisp',
  },
  {
    id: 'border-bottom-dual',
    category: 'border',
    description: 'Convert hardcoded bottom dividers to semantic border-border border-crisp',
    match: /\bborder-b\s+border-(?:zinc|slate)-200(?:\/80)?\s+dark:border-white\/(?:5|8|10)\b/g,
    replacement: 'border-b border-border border-crisp',
  },

  // 4. Typography Hierarchy -> text-text and scaled opacities
  {
    id: 'text-primary-headline',
    category: 'text',
    description: 'Convert hardcoded heading/primary text to text-text',
    match: /\btext-(?:zinc|slate)-900\s+dark:text-(?:white|zinc-100|slate-100)\b/g,
    replacement: 'text-text',
  },
  {
    id: 'text-strong-body',
    category: 'text',
    description: 'Convert hardcoded strong body text to text-text',
    match: /\btext-(?:zinc|slate)-800\s+dark:text-(?:zinc|slate)-200\b/g,
    replacement: 'text-text',
  },
  {
    id: 'text-secondary-label-80',
    category: 'text',
    description: 'Convert secondary neutral text to text-text/80',
    match: /\btext-(?:zinc|slate)-700\s+dark:text-(?:zinc|slate)-300\b/g,
    replacement: 'text-text/80',
  },
  {
    id: 'text-muted-label-70',
    category: 'text',
    description: 'Convert muted neutral text to text-text/70',
    match: /\btext-(?:zinc|slate)-600\s+dark:text-(?:zinc|slate)-400\b/g,
    replacement: 'text-text/70',
  },
  {
    id: 'text-subtle-hint-60',
    category: 'text',
    description: 'Convert subtle hint text to text-text/60',
    match: /\btext-(?:zinc|slate)-500\s+dark:text-(?:zinc|slate)-400\b/g,
    replacement: 'text-text/60',
  },
  {
    id: 'text-faint-caption-40',
    category: 'text',
    description: 'Convert faint caption text to text-text/40',
    match: /\btext-(?:zinc|slate)-400\s+dark:text-(?:zinc|slate)-(?:500|600)\b/g,
    replacement: 'text-text/40',
  },
  {
    id: 'placeholder-subtle',
    category: 'text',
    description: 'Convert hardcoded input placeholder to placeholder-text/40',
    match: /\bplaceholder-(?:zinc|slate)-400\s+dark:placeholder-(?:zinc|slate)-(?:500|600)\b/g,
    replacement: 'placeholder-text/40',
  },

  // 5. Interactive States (Hover & Focus)
  {
    id: 'hover-text-primary',
    category: 'text',
    description: 'Convert hardcoded hover text to hover:text-text',
    match: /\bhover:text-(?:zinc|slate)-900\s+dark:hover:text-(?:white|zinc-100|slate-100)\b/g,
    replacement: 'hover:text-text',
  },
  {
    id: 'hover-bg-subtle',
    category: 'background',
    description: 'Convert hardcoded hover background to hover:bg-background',
    match: /\bhover:bg-(?:zinc|slate)-(?:50|100)\s+dark:hover:bg-(?:zinc|slate)-(?:800|900)\b/g,
    replacement: 'hover:bg-background',
  },
  {
    id: 'hover-bg-hex-dark',
    category: 'background',
    description: 'Convert hardcoded dark hex hover background to hover:bg-background',
    match: /\bhover:bg-white\s+dark:hover:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'hover:bg-background',
  },
  {
    id: 'dark-hover-bg-hex-only',
    category: 'background',
    description: 'Convert dark hover background hex to hover:bg-background',
    match: /\bdark:hover:bg-\[#[0-9A-Fa-f]{6}\]/g,
    replacement: 'dark:hover:bg-background',
  },

  // 7. Hardcoded Orange -> Primary (Fix for the dominant styling defect)
  {
    id: 'bg-orange-to-primary',
    category: 'accent',
    description: 'Convert hardcoded orange backgrounds to primary',
    match: /\bbg-orange-(?:500|600)\b/g,
    replacement: 'bg-primary',
  },
  {
    id: 'text-orange-to-primary',
    category: 'accent',
    description: 'Convert hardcoded orange text to primary',
    match: /\btext-orange-(?:500|600|700)\b/g,
    replacement: 'text-primary',
  },
  {
    id: 'bg-orange-subtle-to-primary-subtle',
    category: 'accent',
    description: 'Convert subtle orange backgrounds to primary/10',
    match: /\bbg-orange-(?:50|100|500\/10)\b/g,
    replacement: 'bg-primary/10',
  },
  {
    id: 'border-orange-to-primary-border',
    category: 'accent',
    description: 'Convert orange borders to primary/30',
    match: /\bborder-orange-(?:200|500\/20|500\/30)\b/g,
    replacement: 'border-primary/30',
  },
  {
    id: 'focus-ring-orange-to-primary',
    category: 'accent',
    description: 'Convert orange focus rings to primary',
    match: /\bfocus:ring-orange-500\b/g,
    replacement: 'focus:ring-primary',
  },
];

export interface ScanOptions {
  targetDirs?: string[];
  fix?: boolean;
  verbose?: boolean;
}

/**
 * Scans directories recursively for component and screen files (.tsx, .ts)
 */
export function getComponentFiles(dirs: string[]): string[] {
  const result: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    const stat = fs.statSync(dir);
    if (stat.isFile()) {
      if (
        (dir.endsWith('.tsx') || dir.endsWith('.ts')) &&
        !dir.endsWith('.d.ts')
      ) {
        result.push(dir);
      }
      continue;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
          result.push(...getComponentFiles([fullPath]));
        }
      } else if (
        (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
        !entry.name.endsWith('.d.ts')
      ) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

/**
 * Validates and optionally fixes a single file according to theme rules
 */
export function processFile(
  filePath: string,
  fix = false
): { violations: ValidationViolation[]; modified: boolean } {
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  let currentContent = originalContent;
  const violations: ValidationViolation[] = [];

  const lines = originalContent.split('\n');

  // Track violations per line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of THEME_RULES) {
      // Reset regexp state
      rule.match.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.match.exec(line)) !== null) {
        violations.push({
          file: filePath,
          line: i + 1,
          ruleId: rule.id,
          category: rule.category,
          matched: match[0],
          replacement: rule.replacement,
        });
      }
    }
  }

  // Apply replacements if fix flag is enabled
  if (fix && violations.length > 0) {
    for (const rule of THEME_RULES) {
      currentContent = currentContent.replace(rule.match, rule.replacement);
    }
    if (currentContent !== originalContent) {
      fs.writeFileSync(filePath, currentContent, 'utf-8');
      return { violations, modified: true };
    }
  }

  return { violations, modified: false };
}

/**
 * Recursively scans and validates all components against the defined CSS theme variables
 */
export function runThemeValidator(options: ScanOptions = {}): ValidationSummary {
  const targetDirs = options.targetDirs || [
    path.resolve(process.cwd(), 'src/components'),
    path.resolve(process.cwd(), 'src/modules'),
    path.resolve(process.cwd(), 'src/context'),
    path.resolve(process.cwd(), 'src/App.tsx'),
  ];
  const fix = options.fix ?? true;
  const verbose = options.verbose ?? false;

  const files = getComponentFiles(targetDirs);
  let totalViolations = 0;
  let filesModified = 0;
  const allViolations: ValidationViolation[] = [];
  const violationsByCategory: Record<string, number> = {
    background: 0,
    border: 0,
    text: 0,
    accent: 0,
    spacing: 0,
  };

  console.log(`\n🔍 [Theme Validator] Scanning ${files.length} component files across:`);
  targetDirs.forEach((d) => console.log(`   - ${path.relative(process.cwd(), d) || '.'}`));
  console.log(`Mode: ${fix ? '⚡ AUTO-FIX (Replace with semantic tokens)' : '📋 AUDIT ONLY'}\n`);

  for (const file of files) {
    const { violations, modified } = processFile(file, fix);

    if (violations.length > 0) {
      totalViolations += violations.length;
      allViolations.push(...violations);
      if (modified) filesModified++;

      for (const v of violations) {
        violationsByCategory[v.category] = (violationsByCategory[v.category] || 0) + 1;
      }

      const relPath = path.relative(process.cwd(), file);
      console.log(
        `${modified ? '✨ [FIXED]' : '⚠️  [FOUND]'} ${relPath} (${violations.length} tokens ${modified ? 'aligned' : 'detected'})`
      );

      if (verbose) {
        violations.forEach((v) => {
          console.log(`    L${v.line}: [${v.matched}] -> [${v.replacement}] (${v.ruleId})`);
        });
      }
    }
  }

  console.log('\n=================== THEME VALIDATION REPORT ===================');
  console.log(`Total Files Scanned:    ${files.length}`);
  console.log(`Files with Inconsistencies: ${allViolations.length > 0 ? (fix ? filesModified : new Set(allViolations.map((v) => v.file)).size) : 0}`);
  console.log(`Total Semantic Tokens Replaced: ${totalViolations}`);
  console.log('Breakdown by Category:');
  Object.entries(violationsByCategory).forEach(([cat, count]) => {
    console.log(`  • ${cat.toUpperCase().padEnd(12)}: ${count}`);
  });
  console.log('================================================================\n');

  return {
    filesScanned: files.length,
    filesModified,
    totalViolations,
    violationsByCategory,
    violations: allViolations,
  };
}

// Auto-run if executed directly as a script (e.g. `npx tsx theme-validator.ts`)
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('theme-validator.ts') || process.argv[1].endsWith('theme-validator.js'));

if (isDirectExecution) {
  const isFix = !process.argv.includes('--check');
  const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const summary = runThemeValidator({ fix: isFix, verbose: isVerbose });
  if (!isFix && summary.totalViolations > 0) {
    process.exitCode = 1;
  }
}

