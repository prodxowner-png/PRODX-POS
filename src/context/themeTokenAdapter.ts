import type { ThemePreset } from './themePresets';

export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

export function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateCustomAccent(accent: string | null, targetLabelHex = '#ffffff'): string | null {
  if (!accent) return null;
  const trimmed = accent.trim();
  if (!isValidHexColor(trimmed)) return null;
  // Require at least 3.0:1 contrast against label
  if (getContrastRatio(trimmed, targetLabelHex) < 3.0) return null;
  return trimmed;
}

const NIGHT_SURFACES = {
  bg: '#12171a',
  surface: '#1b2227',
  surfaceRaised: '#243038',
  surfaceMuted: '#243038',
  surfaceSelected: '#243038',
  surfaceHover: '#1b2227',
  text: '#f2ede4',
  textSecondary: '#b5bbc4',
  textMuted: '#b5bbc4',
  border: '#3c4a54',
  borderStrong: '#6f7e8a',
  cardHover: '#243038',
};

const DAY_FALLBACK_SURFACES = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceRaised: '#F1F5F9',
  surfaceMuted: '#E2E8F0',
  surfaceSelected: '#EFF6FF',
  surfaceHover: '#F1F5F9',
  text: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#475569',
  border: '#E2E8F0',
  borderStrong: '#94A3B8',
  cardHover: '#F1F5F9',
};

export function buildThemeVariables(
  preset: ThemePreset,
  mode: 'light' | 'dark',
  customAccent: string | null,
): Record<string, string> {
  const validatedAccent = validateCustomAccent(customAccent, preset.semanticTokens.primaryText);
  const activePrimary = validatedAccent ?? preset.primary;

  const isDarkMode = mode === 'dark';

  let bgColor = preset.background;
  let cardColor = preset.card;
  let cardHoverColor = preset.cardHover;
  let textColor = preset.text;
  let textMutedColor = preset.textMuted;
  let borderColor = preset.border;
  let borderHoverColor = preset.borderHover;
  let primaryDarkColor = preset.semanticTokens.primaryHover;
  const primaryLightColor = preset.primaryLight;
  const primaryGlow = preset.primaryGlow;

  let brandBg = preset.semanticTokens.bg;
  let brandSurface = preset.semanticTokens.surface;
  let brandSurfaceRaised = preset.semanticTokens.surfaceRaised;
  let brandSurfaceMuted = preset.semanticTokens.surfaceMuted;
  let brandSurfaceSelected = preset.semanticTokens.surfaceSelected;
  let brandSurfaceHover = preset.semanticTokens.surfaceHover;
  let brandText = preset.semanticTokens.text;
  let brandTextSecondary = preset.semanticTokens.textSecondary;
  let brandTextMuted = preset.semanticTokens.textMuted;
  let brandBorder = preset.semanticTokens.border;
  let brandBorderStrong = preset.semanticTokens.borderStrong;

  if (isDarkMode) {
    if (preset.isDark) {
      bgColor = preset.background;
      cardColor = preset.card;
      cardHoverColor = preset.cardHover;
      textColor = preset.text;
      textMutedColor = preset.textMuted;
      borderColor = preset.border;
      borderHoverColor = preset.borderHover;
      primaryDarkColor = preset.semanticTokens.primaryHover;
      brandBg = preset.semanticTokens.bg;
      brandSurface = preset.semanticTokens.surface;
      brandSurfaceRaised = preset.semanticTokens.surfaceRaised;
      brandSurfaceMuted = preset.semanticTokens.surfaceMuted;
      brandSurfaceSelected = preset.semanticTokens.surfaceSelected;
      brandSurfaceHover = preset.semanticTokens.surfaceHover;
      brandText = preset.semanticTokens.text;
      brandTextSecondary = preset.semanticTokens.textSecondary;
      brandTextMuted = preset.semanticTokens.textMuted;
      brandBorder = preset.semanticTokens.border;
      brandBorderStrong = preset.semanticTokens.borderStrong;
    } else {
      bgColor = NIGHT_SURFACES.bg;
      cardColor = NIGHT_SURFACES.surface;
      cardHoverColor = NIGHT_SURFACES.cardHover;
      textColor = NIGHT_SURFACES.text;
      textMutedColor = NIGHT_SURFACES.textMuted;
      borderColor = NIGHT_SURFACES.border;
      borderHoverColor = NIGHT_SURFACES.borderStrong;
      primaryDarkColor = preset.semanticTokens.primaryHover;
      brandBg = NIGHT_SURFACES.bg;
      brandSurface = NIGHT_SURFACES.surface;
      brandSurfaceRaised = NIGHT_SURFACES.surfaceRaised;
      brandSurfaceMuted = NIGHT_SURFACES.surfaceMuted;
      brandSurfaceSelected = NIGHT_SURFACES.surfaceSelected;
      brandSurfaceHover = NIGHT_SURFACES.surfaceHover;
      brandText = NIGHT_SURFACES.text;
      brandTextSecondary = NIGHT_SURFACES.textSecondary;
      brandTextMuted = NIGHT_SURFACES.textMuted;
      brandBorder = NIGHT_SURFACES.border;
      brandBorderStrong = NIGHT_SURFACES.borderStrong;
    }
  } else {
    if (!preset.isDark) {
      bgColor = preset.background;
      cardColor = preset.card;
      cardHoverColor = preset.cardHover;
      textColor = preset.text;
      textMutedColor = preset.textMuted;
      borderColor = preset.border;
      borderHoverColor = preset.borderHover;
      primaryDarkColor = preset.semanticTokens.primaryHover;
      brandBg = preset.semanticTokens.bg;
      brandSurface = preset.semanticTokens.surface;
      brandSurfaceRaised = preset.semanticTokens.surfaceRaised;
      brandSurfaceMuted = preset.semanticTokens.surfaceMuted;
      brandSurfaceSelected = preset.semanticTokens.surfaceSelected;
      brandSurfaceHover = preset.semanticTokens.surfaceHover;
      brandText = preset.semanticTokens.text;
      brandTextSecondary = preset.semanticTokens.textSecondary;
      brandTextMuted = preset.semanticTokens.textMuted;
      brandBorder = preset.semanticTokens.border;
      brandBorderStrong = preset.semanticTokens.borderStrong;
    } else {
      bgColor = DAY_FALLBACK_SURFACES.bg;
      cardColor = DAY_FALLBACK_SURFACES.surface;
      cardHoverColor = DAY_FALLBACK_SURFACES.cardHover;
      textColor = DAY_FALLBACK_SURFACES.text;
      textMutedColor = DAY_FALLBACK_SURFACES.textMuted;
      borderColor = DAY_FALLBACK_SURFACES.border;
      borderHoverColor = DAY_FALLBACK_SURFACES.borderStrong;
      primaryDarkColor = preset.semanticTokens.primaryHover;
      brandBg = DAY_FALLBACK_SURFACES.bg;
      brandSurface = DAY_FALLBACK_SURFACES.surface;
      brandSurfaceRaised = DAY_FALLBACK_SURFACES.surfaceRaised;
      brandSurfaceMuted = DAY_FALLBACK_SURFACES.surfaceMuted;
      brandSurfaceSelected = DAY_FALLBACK_SURFACES.surfaceSelected;
      brandSurfaceHover = DAY_FALLBACK_SURFACES.surfaceHover;
      brandText = DAY_FALLBACK_SURFACES.text;
      brandTextSecondary = DAY_FALLBACK_SURFACES.textSecondary;
      brandTextMuted = DAY_FALLBACK_SURFACES.textMuted;
      brandBorder = DAY_FALLBACK_SURFACES.border;
      brandBorderStrong = DAY_FALLBACK_SURFACES.borderStrong;
    }
  }

  const focusRing = isDarkMode
    ? '#ff782e'
    : (preset.id === 'prodx_signature' || preset.id === 'forest_luxury' ? '#0f2a22' : '#ea580c');

  return {
    '--primary-color': activePrimary,
    '--primary-dark': primaryDarkColor,
    '--primary-light': primaryLightColor,
    '--primary-glow': primaryGlow,
    '--bg-color': bgColor,
    '--card-color': cardColor,
    '--card-hover': cardHoverColor,
    '--text-color': textColor,
    '--text-muted': textMutedColor,
    '--border-color': borderColor,
    '--border-hover': borderHoverColor,
    '--button-radius': preset.buttonRadius,
    '--card-radius': preset.cardRadius,
    '--focus-ring': focusRing,
    '--focus-ring-offset': '2px',

    // Semantic roles
    '--brand-bg': brandBg,
    '--brand-surface': brandSurface,
    '--brand-surface-raised': brandSurfaceRaised,
    '--brand-surface-muted': brandSurfaceMuted,
    '--brand-surface-selected': brandSurfaceSelected,
    '--brand-surface-hover': brandSurfaceHover,
    '--brand-text': brandText,
    '--brand-text-secondary': brandTextSecondary,
    '--brand-text-muted': brandTextMuted,
    '--brand-border': brandBorder,
    '--brand-border-strong': brandBorderStrong,
    '--brand-primary': activePrimary,
    '--brand-primary-hover': preset.semanticTokens.primaryHover,
    '--brand-primary-pressed': preset.semanticTokens.primaryPressed,
    '--brand-primary-text': preset.semanticTokens.primaryText,

    // Status and CTA tokens (preserved across all presets)
    '--brand-cta': preset.semanticTokens.cta,
    '--brand-cta-hover': preset.semanticTokens.ctaHover,
    '--brand-cta-pressed': preset.semanticTokens.ctaPressed,
    '--brand-cta-text': preset.semanticTokens.ctaText,
    '--brand-cta-subtle': preset.semanticTokens.ctaSubtle,
    '--brand-success': preset.semanticTokens.success,
    '--brand-success-text': preset.semanticTokens.successText,
    '--brand-success-subtle': preset.semanticTokens.successSubtle,
    '--brand-warning': preset.semanticTokens.warning,
    '--brand-warning-text': preset.semanticTokens.warningText,
    '--brand-warning-subtle': preset.semanticTokens.warningSubtle,
    '--brand-danger': preset.semanticTokens.danger,
    '--brand-danger-text': preset.semanticTokens.dangerText,
    '--brand-danger-subtle': preset.semanticTokens.dangerSubtle,
    '--brand-info': preset.semanticTokens.info,
    '--brand-info-text': preset.semanticTokens.infoText,
    '--brand-info-subtle': preset.semanticTokens.infoSubtle,
  };
}
