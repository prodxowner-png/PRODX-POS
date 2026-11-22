/**
 * Runtime-independent contract for the approved PRODX semantic brand tokens.
 * CSS remains the source of truth for palette values; this module validates
 * that the required semantic roles stay available to consuming components.
 */

export const REQUIRED_BRAND_SEMANTIC_TOKENS = [
  '--brand-bg',
  '--brand-surface',
  '--brand-surface-raised',
  '--brand-surface-muted',
  '--brand-surface-selected',
  '--brand-surface-hover',
  '--brand-text',
  '--brand-text-secondary',
  '--brand-text-muted',
  '--brand-text-disabled',
  '--brand-text-accent',
  '--brand-text-gold',
  '--brand-text-link',
  '--brand-border',
  '--brand-border-strong',
  '--brand-border-decorative',
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-pressed',
  '--brand-primary-text',
  '--brand-cta',
  '--brand-cta-hover',
  '--brand-cta-pressed',
  '--brand-cta-text',
  '--brand-cta-subtle',
  '--brand-gold',
  '--brand-gold-subtle',
  '--brand-success',
  '--brand-success-text',
  '--brand-success-subtle',
  '--brand-warning',
  '--brand-warning-text',
  '--brand-warning-subtle',
  '--brand-danger',
  '--brand-danger-text',
  '--brand-danger-subtle',
  '--brand-info',
  '--brand-info-text',
  '--brand-info-subtle',
] as const;

export const REQUIRED_DARK_OVERRIDES = [
  '--brand-bg',
  '--brand-surface',
  '--brand-surface-raised',
  '--brand-surface-muted',
  '--brand-surface-selected',
  '--brand-surface-hover',
  '--brand-text',
  '--brand-text-secondary',
  '--brand-text-muted',
  '--brand-text-disabled',
  '--brand-text-accent',
  '--brand-text-gold',
  '--brand-text-link',
  '--brand-border',
  '--brand-border-strong',
  '--brand-border-decorative',
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-pressed',
  '--brand-primary-text',
  '--brand-cta',
  '--brand-cta-hover',
  '--brand-cta-pressed',
  '--brand-cta-text',
  '--brand-cta-subtle',
  '--brand-success-text',
  '--brand-success-subtle',
  '--brand-warning-text',
  '--brand-warning-subtle',
  '--brand-danger-text',
  '--brand-danger-subtle',
  '--brand-info-text',
  '--brand-info-subtle',
] as const;

export interface TokenValidationResult {
  missingLightTokens: string[];
  missingDarkOverrides: string[];
  darkCtaText: string | null;
  ctaUsesApprovedOrange: boolean;
  statusRolesComplete: boolean;
}

export function validateBrandTokenContract(cssContent: string): TokenValidationResult {
  // Split cssContent into :root block and dark block
  const darkBlockMatch = cssContent.match(/(?::root\.dark|\.dark|\[data-theme="dark"\])\s*\{([^}]+)\}/s);
  const darkBlock = darkBlockMatch ? darkBlockMatch[1] : '';

  // Extract root block (before dark block)
  const rootBlockMatch = cssContent.match(/:root\s*\{([^}]+)\}/s);
  const rootBlock = rootBlockMatch ? rootBlockMatch[1] : '';

  const missingLightTokens = REQUIRED_BRAND_SEMANTIC_TOKENS.filter((token) => {
    const regex = new RegExp(`${token}\\s*:`, 'm');
    return !regex.test(rootBlock);
  });

  const missingDarkOverrides = REQUIRED_DARK_OVERRIDES.filter((token) => {
    const regex = new RegExp(`${token}\\s*:`, 'm');
    return !regex.test(darkBlock);
  });

  const darkCtaTextMatch = darkBlock.match(/--brand-cta-text\s*:\s*([^;]+);/);
  const darkCtaText = darkCtaTextMatch ? darkCtaTextMatch[1].trim() : null;

  const ctaUsesApprovedOrange =
    /--brand-cta\s*:\s*var\(--brand-orange-500\)/.test(rootBlock) &&
    /--brand-cta\s*:\s*var\(--brand-orange-500\)/.test(darkBlock);

  const statusRoles = [
    '--brand-success',
    '--brand-warning',
    '--brand-danger',
    '--brand-info',
  ];
  const statusRolesComplete = statusRoles.every((role) => {
    return (
      new RegExp(`${role}\\s*:`).test(rootBlock) &&
      new RegExp(`${role}-text\\s*:`).test(rootBlock) &&
      new RegExp(`${role}-subtle\\s*:`).test(rootBlock)
    );
  });

  return {
    missingLightTokens,
    missingDarkOverrides,
    darkCtaText,
    ctaUsesApprovedOrange,
    statusRolesComplete,
  };
}
