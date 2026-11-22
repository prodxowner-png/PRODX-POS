/**
 * PRODX POS - Global Enterprise Theme Preset System
 * 10 Deterministic, Modern, and Premium 1-Click Theme Presets.
 * Completely harmonized with semantic brand tokens and legacy runtime CSS variables.
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import ConfigPersistenceManager from '../services/configPersistenceManager';
import { THEME_PRESETS, resolveLegacyPresetId, type ThemePreset } from './themePresets';
import { buildThemeVariables } from './themeTokenAdapter';

export { THEME_PRESETS, resolveLegacyPresetId, type ThemePreset } from './themePresets';

export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  activePresetId: string;
  currentPreset: ThemePreset;
  setPreset: (id: string) => void;
  customAccentColor: string | null;
  setCustomAccentColor: (color: string | null) => void;
  customLogo: string | null;
  setCustomLogo: (logo: string | null) => void;
  resetAllThemeSettings: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePresetId, setActivePresetId] = useState<string>(() => {
    const saved = ConfigPersistenceManager.getConfig().theme.presetId;
    return resolveLegacyPresetId(saved || 'prodx_signature');
  });

  const [customAccentColor, setCustomAccentColorState] = useState<string | null>(() => {
    return ConfigPersistenceManager.getConfig().branding.customAccentColor;
  });

  const [customLogo, setCustomLogoState] = useState<string | null>(() => {
    return ConfigPersistenceManager.getConfig().branding.customLogo;
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    return ConfigPersistenceManager.getConfig().theme.mode || 'system';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Synchronize theme across open tabs when localStorage changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'PRODX_STORE_CONFIG_STATE') {
        const config = ConfigPersistenceManager.getConfig();
        if (config.theme?.presetId && config.theme.presetId !== activePresetId) {
          setActivePresetId(resolveLegacyPresetId(config.theme.presetId));
        }
        if (config.theme?.mode && config.theme.mode !== themeMode) {
          setThemeModeState(config.theme.mode);
        }
        if (config.branding?.customAccentColor !== undefined && config.branding.customAccentColor !== customAccentColor) {
          setCustomAccentColorState(config.branding.customAccentColor);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [activePresetId, themeMode, customAccentColor]);

  const currentPreset = useMemo(() => {
    return THEME_PRESETS.find((p) => p.id === activePresetId) || THEME_PRESETS[0];
  }, [activePresetId]);

  const theme: Theme = themeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    const isDarkMode = theme === 'dark';
    const root = document.documentElement;

    const themeVars = buildThemeVariables(currentPreset, theme, customAccentColor);
    for (const [property, value] of Object.entries(themeVars)) {
      root.style.setProperty(property, value);
    }

    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Persist current visual settings via the unified config manager
    ConfigPersistenceManager.updateConfig({
      theme: { mode: themeMode, presetId: activePresetId },
      branding: { customLogo, customAccentColor },
    });

    localStorage.setItem('prodx_pos_theme_mode', themeMode);
    localStorage.setItem('prodx_pos_theme_preset', activePresetId);
    if (customAccentColor) {
      localStorage.setItem('prodx_custom_accent_color', customAccentColor);
    } else {
      localStorage.removeItem('prodx_custom_accent_color');
    }
  }, [theme, themeMode, activePresetId, customAccentColor, customLogo, currentPreset]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
  };

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextTheme);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeMode(newTheme);
  };

  // 1-Click Preset Activation: activates colors, surfaces, borders, button style, and matching native mode
  const setPreset = (id: string) => {
    const resolvedId = resolveLegacyPresetId(id);
    const nextPreset = THEME_PRESETS.find((p) => p.id === resolvedId);
    if (nextPreset) {
      setActivePresetId(resolvedId);
      setCustomAccentColorState(null); // Clean slate for full preset fidelity
      setThemeModeState(nextPreset.isDark ? 'dark' : 'light');
    }
  };

  const setCustomAccentColor = (color: string | null) => {
    setCustomAccentColorState(color);
  };

  const setCustomLogo = (logo: string | null) => {
    setCustomLogoState(logo);
  };

  const resetAllThemeSettings = () => {
    setActivePresetId('prodx_signature');
    setCustomAccentColorState(null);
    setCustomLogoState(null);
    setThemeModeState('light');
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeMode,
        setThemeMode,
        toggleTheme,
        setTheme,
        activePresetId,
        currentPreset,
        setPreset,
        customAccentColor,
        setCustomAccentColor,
        customLogo,
        setCustomLogo,
        resetAllThemeSettings,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    const cfg = ConfigPersistenceManager.getConfig();
    const fallbackPreset = THEME_PRESETS[0];
    return {
      theme: 'light',
      themeMode: 'system',
      setThemeMode: () => {},
      toggleTheme: () => {},
      setTheme: () => {},
      activePresetId: resolveLegacyPresetId(cfg.theme?.presetId || fallbackPreset.id),
      currentPreset: fallbackPreset,
      setPreset: () => {},
      customAccentColor: cfg.branding?.customAccentColor ?? null,
      setCustomAccentColor: () => {},
      customLogo: cfg.branding?.customLogo ?? null,
      setCustomLogo: () => {},
      resetAllThemeSettings: () => {},
    };
  }
  return ctx;
}
