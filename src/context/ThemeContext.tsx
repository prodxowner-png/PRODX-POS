/**
 * PRODX POS - Global Enterprise Theme Preset System
 * 6 Top Professional, Modern, and Premium 1-Click Theme Presets.
 * Completely harmonized: Primary, Background, Cards, Text, Borders, Button Styles, Radii & Glows.
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import ConfigPersistenceManager from '../services/configPersistenceManager';

export interface ThemePreset {
  id: string;
  name: { th: string; en: string };
  category: { th: string; en: string };
  tagline: { th: string; en: string };
  description: { th: string; en: string };
  isDark: boolean;
  // Color Palette Tokens
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryGlow: string;
  background: string;
  card: string;
  cardHover: string;
  text: string;
  textMuted: string;
  border: string;
  borderHover: string;
  // UI Component & Button Styling
  buttonRadius: string;
  cardRadius: string;
  buttonStyle: 'modern' | 'minimal' | 'luxury' | 'cyber' | 'warm' | 'executive';
  badge: string;
  swatches: string[];
}

export const THEME_PRESETS: ThemePreset[] = [
  // 1. Enterprise Obsidian (Modern SaaS High-Tech Dark)
  {
    id: 'enterprise_obsidian',
    name: { th: 'ดิพ ออบซิเดียน เอนเตอร์ไพรส์', en: 'Enterprise Obsidian' },
    category: { th: 'โมเดิร์น ไฮเทค (Tech & SaaS)', en: 'Modern High-Tech SaaS' },
    tagline: { th: 'ดาร์กโหมดพรีเมียม สไตล์ระบบองค์กรล้ำสมัย', en: 'Flagship enterprise dark interface with electric sapphire' },
    description: {
      th: 'พื้นหลังสีออบซิเดียนผสานสีแซฟไฟร์บลูคมชัด สบายตา ออกแบบสำหรับร้านค้าทันสมัยและแฟล็กชิปสโตร์',
      en: 'Obsidian deep slate canvas with electric sapphire blue accents, engineered for high-volume retail & modern stores.',
    },
    isDark: true,
    primary: '#3B82F6',
    primaryDark: '#1D4ED8',
    primaryLight: 'rgba(59, 130, 246, 0.12)',
    primaryGlow: 'rgba(59, 130, 246, 0.25)',
    background: '#090D16',
    card: '#0F172A',
    cardHover: '#1E293B',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    border: '#1E293B',
    borderHover: '#334155',
    buttonRadius: '12px',
    cardRadius: '16px',
    buttonStyle: 'modern',
    badge: 'TOP TECH',
    swatches: ['#3B82F6', '#090D16', '#0F172A', '#1E293B'],
  },

  // 2. Nordic Clean Slate (Minimalist Scandinavian Light)
  {
    id: 'nordic_slate',
    name: { th: 'นอร์ดิก คลีน สเลต', en: 'Nordic Clean Slate' },
    category: { th: 'มินิมอล ไลท์ (Minimalist Light)', en: 'Nordic Clean Minimal' },
    tagline: { th: 'สว่าง สะอาดตา เรียบหรูสไตล์สแกนดิเนเวียน', en: 'Pure airy Scandinavian white with royal ocean blue' },
    description: {
      th: 'พื้นหลังสีสเลตขาวสะอาดตา ตัวหนังสือคมชัดสูง ปุ่มสีน้ำเงินรอยัลโอเชียน สบายตา ใช้งานได้ทั้งวัน',
      en: 'Clean Scandinavian aesthetic with high-contrast typography and royal ocean blue accents, optimal for day-long operations.',
    },
    isDark: false,
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    primaryLight: 'rgba(37, 99, 235, 0.08)',
    primaryGlow: 'rgba(37, 99, 235, 0.18)',
    background: '#F8FAFC',
    card: '#FFFFFF',
    cardHover: '#F1F5F9',
    text: '#0F172A',
    textMuted: '#475569',
    border: '#E2E8F0',
    borderHover: '#CBD5E1',
    buttonRadius: '12px',
    cardRadius: '16px',
    buttonStyle: 'minimal',
    badge: 'POPULAR',
    swatches: ['#2563EB', '#F8FAFC', '#FFFFFF', '#0F172A'],
  },

  // 3. Royal Emerald Velvet (Organic Luxury / Gourmet & Spa)
  {
    id: 'royal_emerald',
    name: { th: 'รอยัล เอ็มเมอรัลด์ เวลเวท', en: 'Royal Emerald Velvet' },
    category: { th: 'กูร์เมต์ & สปา (Organic Luxury)', en: 'Luxury Gourmet & Spa' },
    tagline: { th: 'สีเขียวมรกตหรูหรา ธรรมชาติระดับไฮเอนด์', en: 'Prestige forest emerald and refined botanical luxury' },
    description: {
      th: 'โทนเขียวมรกตลักชัวรี พื้นผิวมิ้นท์อ่อน ให้ความรู้สึกพรีเมียม สุขภาพดี เหมาะกับร้านอาหาร คาเฟ่พิเศษ และสปา',
      en: 'Rich emerald green with delicate mint whisper undertones, designed for fine dining, gourmet grocers, and boutique spas.',
    },
    isDark: false,
    primary: '#059669',
    primaryDark: '#047857',
    primaryLight: 'rgba(5, 150, 105, 0.09)',
    primaryGlow: 'rgba(5, 150, 105, 0.22)',
    background: '#F4FBF7',
    card: '#FFFFFF',
    cardHover: '#ECFDF5',
    text: '#064E3B',
    textMuted: '#047857',
    border: '#D1FAE5',
    borderHover: '#A7F3D0',
    buttonRadius: '14px',
    cardRadius: '18px',
    buttonStyle: 'luxury',
    badge: 'PREMIUM',
    swatches: ['#059669', '#F4FBF7', '#FFFFFF', '#064E3B'],
  },

  // 4. Cyberpunk Neon Dusk (High-Energy / Electronic & Night Lounge)
  {
    id: 'cyberpunk_neon',
    name: { th: 'ไซเบอร์พังก์ นีออน ดัสก์', en: 'Cyberpunk Neon Dusk' },
    category: { th: 'สตรีท & ไนท์ไลฟ์ (High-Energy Cyber)', en: 'High-Energy Cyberpunk' },
    tagline: { th: 'นีออนไซอันเฉียบคม พื้นผิวอัลลอยด์มิดไนท์', en: 'Electric cyan neon with midnight alloy dark surface' },
    description: {
      th: 'คอนทราสต์จัดจ้าน สีฟ้าไซอันสะท้อนแสงบนแคนวาสสีดำมิดไนท์ สแกนสายตารวดเร็ว ตอบสนองฉับไวสำหรับบาร์และเลานจ์',
      en: 'Vivid neon cyan on midnight alloy surfaces, delivering rapid glanceability in energetic nightlife, lounges, and tech pop-ups.',
    },
    isDark: true,
    primary: '#06B6D4',
    primaryDark: '#0891B2',
    primaryLight: 'rgba(6, 182, 212, 0.14)',
    primaryGlow: 'rgba(6, 182, 212, 0.35)',
    background: '#0B0F19',
    card: '#111827',
    cardHover: '#1F2937',
    text: '#F9FAFB',
    textMuted: '#9CA3AF',
    border: '#1F2937',
    borderHover: '#374151',
    buttonRadius: '10px',
    cardRadius: '14px',
    buttonStyle: 'cyber',
    badge: 'NEON VIBE',
    swatches: ['#06B6D4', '#0B0F19', '#111827', '#F9FAFB'],
  },

  // 5. Sunset Terracotta & Amber (Artisan Warmth / Bakery, Cafe & Bistro)
  {
    id: 'sunset_terracotta',
    name: { th: 'ซันเซ็ต เทอร์ราคอตต้า', en: 'Sunset Terracotta & Amber' },
    category: { th: 'อบอุ่น อาร์ติซาน (Warm Artisan)', en: 'Artisan Warmth & Bistro' },
    tagline: { th: 'สีส้มดินเผาอบอุ่น ให้บรรยากาศคาเฟ่อบอุ่นเป็นกันเอง', en: 'Warm Tuscan terracotta flame and cozy amber glow' },
    description: {
      th: 'สีส้มเทอร์ราคอตต้าผสานพื้นหลังสีครีมอบอุ่น ชวนน่ารับประทาน สร้างความผูกพันและบรรยากาศอบอุ่นในร้านเบเกอรี่และบิสโทร',
      en: 'Warm terracotta and golden amber palette, crafting an inviting and appetizing atmosphere for bakeries, cafes, and bistros.',
    },
    isDark: false,
    primary: '#EA580C',
    primaryDark: '#C2410C',
    primaryLight: 'rgba(234, 88, 12, 0.09)',
    primaryGlow: 'rgba(234, 88, 12, 0.2)',
    background: '#FFFBF7',
    card: '#FFFFFF',
    cardHover: '#FFF7ED',
    text: '#431407',
    textMuted: '#9A3412',
    border: '#FFEDD5',
    borderHover: '#FED7AA',
    buttonRadius: '16px',
    cardRadius: '20px',
    buttonStyle: 'warm',
    badge: 'WARMTH',
    swatches: ['#EA580C', '#FFFBF7', '#FFFFFF', '#431407'],
  },

  // 6. Midnight Velvet Indigo (Executive Luxury / Watches & Fine Living)
  {
    id: 'midnight_indigo',
    name: { th: 'มิดไนท์ เวลเวท อินดิโก้', en: 'Midnight Velvet Indigo' },
    category: { th: 'เอ็กเซกคิวทีฟ ลักชัวรี (Executive Luxury)', en: 'Executive Velvet Luxury' },
    tagline: { th: 'สีม่วงคอสมิกอินดิโก้บนค่ำคืนเวลเวทหรูหราระดับพรีเมียม', en: 'Cosmic indigo purple on deep sapphire velvet surface' },
    description: {
      th: 'ความหรูหราแบบเอ็กเซกคิวทีฟ สีม่วงอินดิโก้เปล่งประกายบนพื้นผิวมิดไนท์เวลเวท สำหรับร้านนาฬิกา อัญมณี และซาลอนชั้นนำ',
      en: 'Royal cosmic indigo on deep velvet midnight sapphire, engineered for high-end boutiques, jewelry stores, and luxury venues.',
    },
    isDark: true,
    primary: '#6366F1',
    primaryDark: '#4F46E5',
    primaryLight: 'rgba(99, 102, 241, 0.13)',
    primaryGlow: 'rgba(99, 102, 241, 0.28)',
    background: '#0A0A14',
    card: '#13132B',
    cardHover: '#1E1E3F',
    text: '#F8FAFC',
    textMuted: '#A5B4FC',
    border: '#23234A',
    borderHover: '#3B3B6D',
    buttonRadius: '12px',
    cardRadius: '16px',
    buttonStyle: 'executive',
    badge: 'EXECUTIVE',
    swatches: ['#6366F1', '#0A0A14', '#13132B', '#F8FAFC'],
  },
];

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
    // Fallback if saved legacy preset id is no longer in the 6 presets
    const match = THEME_PRESETS.find((p) => p.id === saved);
    if (match) return saved;
    // Map old legacy IDs to new 6 presets
    if (saved === 'enterprise_blue' || saved === 'modern' || saved === 'minimal' || saved === 'ocean') {
      return 'nordic_slate';
    }
    if (saved === 'deep_obsidian' || saved === 'dark_elegant') {
      return 'enterprise_obsidian';
    }
    if (saved === 'emerald') return 'royal_emerald';
    if (saved === 'cyberpunk') return 'cyberpunk_neon';
    if (saved === 'sunset') return 'sunset_terracotta';
    if (saved === 'lavender') return 'midnight_indigo';
    return 'enterprise_obsidian';
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
          setActivePresetId(config.theme.presetId);
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

    const activeAccentColor = customAccentColor || currentPreset.primary;

    let bgColor = currentPreset.background;
    let cardColor = currentPreset.card;
    let cardHoverColor = currentPreset.cardHover;
    let textColor = currentPreset.text;
    let textMutedColor = currentPreset.textMuted;
    let borderColor = currentPreset.border;
    let borderHoverColor = currentPreset.borderHover;
    let primaryColor = activeAccentColor;
    let primaryDarkColor = currentPreset.primaryDark;
    let primaryLightColor = currentPreset.primaryLight;
    let primaryGlow = currentPreset.primaryGlow;

    // If using custom accent color, we need to derive the supporting variants dynamically
    // to prevent visual clashing (e.g. blue glows on a custom red brand color)
    if (customAccentColor) {
      // Very simple derivation for production-grade dynamic themes
      primaryDarkColor = activeAccentColor; // In a full implementation we'd darken this
      primaryLightColor = `${activeAccentColor}20`; // Add 12% alpha (hex 20)
      primaryGlow = `${activeAccentColor}40`; // Add 25% alpha (hex 40)
    }

    if (isDarkMode) {
      if (currentPreset.isDark) {
        bgColor = currentPreset.background;
        cardColor = currentPreset.card;
        cardHoverColor = currentPreset.cardHover;
        textColor = currentPreset.text;
        textMutedColor = currentPreset.textMuted;
        borderColor = currentPreset.border;
        borderHoverColor = currentPreset.borderHover;
        primaryColor = activeAccentColor;
        primaryDarkColor = currentPreset.primaryDark;
        primaryLightColor = currentPreset.primaryLight;
        primaryGlow = currentPreset.primaryGlow;
      } else {
        // Light preset forced to dark mode
        bgColor = '#090D16';
        cardColor = '#0F172A';
        cardHoverColor = '#1E293B';
        textColor = '#F8FAFC';
        textMutedColor = '#94A3B8';
        borderColor = '#1E293B';
        borderHoverColor = '#334155';
        primaryColor = activeAccentColor;
        primaryDarkColor = '#1D4ED8';
        primaryLightColor = 'rgba(59, 130, 246, 0.12)';
        primaryGlow = 'rgba(59, 130, 246, 0.25)';
      }
    } else {
      if (!currentPreset.isDark) {
        bgColor = currentPreset.background;
        cardColor = currentPreset.card;
        cardHoverColor = currentPreset.cardHover;
        textColor = currentPreset.text;
        textMutedColor = currentPreset.textMuted;
        borderColor = currentPreset.border;
        borderHoverColor = currentPreset.borderHover;
        primaryColor = activeAccentColor;
        primaryDarkColor = currentPreset.primaryDark;
        primaryLightColor = currentPreset.primaryLight;
        primaryGlow = currentPreset.primaryGlow;
      } else {
        // Dark preset forced to light mode
        bgColor = '#F8FAFC';
        cardColor = '#FFFFFF';
        cardHoverColor = '#F1F5F9';
        textColor = '#0F172A';
        textMutedColor = '#475569';
        borderColor = '#E2E8F0';
        borderHoverColor = '#CBD5E1';
        primaryColor = activeAccentColor;
        primaryDarkColor = '#1D4ED8';
        primaryLightColor = 'rgba(37, 99, 235, 0.08)';
        primaryGlow = 'rgba(37, 99, 235, 0.18)';
      }
    }

    root.style.setProperty('--primary-color', primaryColor);
    root.style.setProperty('--primary-dark', primaryDarkColor);
    root.style.setProperty('--primary-light', primaryLightColor);
    root.style.setProperty('--primary-glow', primaryGlow);
    root.style.setProperty('--bg-color', bgColor);
    root.style.setProperty('--card-color', cardColor);
    root.style.setProperty('--card-hover', cardHoverColor);
    root.style.setProperty('--text-color', textColor);
    root.style.setProperty('--text-muted', textMutedColor);
    root.style.setProperty('--border-color', borderColor);
    root.style.setProperty('--border-hover', borderHoverColor);
    root.style.setProperty('--button-radius', currentPreset.buttonRadius);
    root.style.setProperty('--card-radius', currentPreset.cardRadius);

    // WCAG 2.2 AA Non-Text Contrast: #ea580c is 3.57:1 on white; #ff782e is 6.8:1 on dark
    const focusRingColor = isDarkMode ? '#ff782e' : '#ea580c';
    root.style.setProperty('--focus-ring', focusRingColor);
    root.style.setProperty('--focus-ring-offset', '2px');

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
    const nextPreset = THEME_PRESETS.find((p) => p.id === id);
    if (nextPreset) {
      setActivePresetId(id);
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
    setActivePresetId('enterprise_obsidian');
    setCustomAccentColorState(null);
    setCustomLogoState(null);
    setThemeModeState('dark');
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
      theme: 'dark',
      themeMode: 'system',
      setThemeMode: () => {},
      toggleTheme: () => {},
      setTheme: () => {},
      activePresetId: cfg.theme.presetId || fallbackPreset.id,
      currentPreset: fallbackPreset,
      setPreset: () => {},
      customAccentColor: cfg.branding.customAccentColor,
      setCustomAccentColor: () => {},
      customLogo: cfg.branding.customLogo,
      setCustomLogo: () => {},
      resetAllThemeSettings: () => {},
    };
  }
  return ctx;
}
