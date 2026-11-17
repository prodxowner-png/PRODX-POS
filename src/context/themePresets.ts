/**
 * PRODX POS - 10 Deterministic Theme Presets
 * Preserves existing 6 persisted presets and legacy aliases while adding
 * PRODX Signature, Forest Luxury, Rose Luxury, and Classic Light.
 */

export interface ThemeSemanticTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  surfaceSelected: string;
  surfaceHover: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  primaryText: string;
  cta: string;
  ctaHover: string;
  ctaPressed: string;
  ctaText: string;
  ctaSubtle: string;
  success: string;
  successText: string;
  successSubtle: string;
  warning: string;
  warningText: string;
  warningSubtle: string;
  danger: string;
  dangerText: string;
  dangerSubtle: string;
  info: string;
  infoText: string;
  infoSubtle: string;
}

export const REQUIRED_THEME_SEMANTIC_ROLES: (keyof ThemeSemanticTokens)[] = [
  'bg',
  'surface',
  'surfaceRaised',
  'surfaceMuted',
  'surfaceSelected',
  'surfaceHover',
  'text',
  'textSecondary',
  'textMuted',
  'border',
  'borderStrong',
  'primary',
  'primaryHover',
  'primaryPressed',
  'primaryText',
  'cta',
  'ctaHover',
  'ctaPressed',
  'ctaText',
  'ctaSubtle',
  'success',
  'successText',
  'successSubtle',
  'warning',
  'warningText',
  'warningSubtle',
  'danger',
  'dangerText',
  'dangerSubtle',
  'info',
  'infoText',
  'infoSubtle',
];

export interface ThemePreset {
  id: string;
  name: { th: string; en: string };
  category: { th: string; en: string };
  tagline: { th: string; en: string };
  description: { th: string; en: string };
  isDark: boolean;
  // Legacy Color Palette Tokens
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
  // Complete semantic token map
  semanticTokens: ThemeSemanticTokens;
}

const SHARED_CTA_AND_STATUS = {
  cta: '#e8894a',
  ctaHover: '#ee9659',
  ctaPressed: '#d97a3b',
  ctaText: '#20242b',
  ctaSubtle: '#fce9db',
  success: '#1a7f4f',
  successText: '#12633d',
  successSubtle: '#ddf3e7',
  warning: '#d69a2d',
  warningText: '#7a4e0a',
  warningSubtle: '#fbefd2',
  danger: '#c62f2f',
  dangerText: '#9b1c1c',
  dangerSubtle: '#fbe1e1',
  info: '#2b6cb0',
  infoText: '#1e4e85',
  infoSubtle: '#dcebf8',
};

export const THEME_PRESETS: ThemePreset[] = [
  // 1. PRODX Signature (Canonical Forest / Cream / Peach)
  {
    id: 'prodx_signature',
    name: { th: 'พีอาร์โอดีเอ็กซ์ ซิกเนเจอร์', en: 'PRODX Signature' },
    category: { th: 'เอกลักษณ์องค์กร (Brand Signature)', en: 'Flagship Brand Signature' },
    tagline: { th: 'โทนเขียวฟอเรสต์ผสานครีมอบอุ่น เอกลักษณ์แบรนด์ PRODX', en: 'Forest green, warm cream, and refined orange CTA' },
    description: {
      th: 'โทนสีหลักของแบรนด์ PRODX ผสานสีเขียวฟอเรสต์เข้มกับพื้นผิวสีครีมนุ่มนวล สบายตา ใช้งานได้ตลอดวัน',
      en: 'The definitive PRODX identity pairing deep forest green with warm cream surfaces and clear orange CTA.',
    },
    isDark: false,
    primary: '#183d32',
    primaryDark: '#0f2a22',
    primaryLight: 'rgba(24, 61, 50, 0.08)',
    primaryGlow: 'rgba(24, 61, 50, 0.18)',
    background: '#f7f1e8',
    card: '#fbf8f3',
    cardHover: '#ede4d5',
    text: '#20242b',
    textMuted: '#5a616d',
    border: '#d2d6dc',
    borderHover: '#a3a9b3',
    buttonRadius: '12px',
    cardRadius: '16px',
    buttonStyle: 'luxury',
    badge: 'CANONICAL',
    swatches: ['#183d32', '#f7f1e8', '#e8894a', '#20242b'],
    semanticTokens: {
      bg: '#f7f1e8',
      surface: '#fbf8f3',
      surfaceRaised: '#fbf8f3',
      surfaceMuted: '#ede4d5',
      surfaceSelected: '#dcebe3',
      surfaceHover: '#eef5f1',
      text: '#20242b',
      textSecondary: '#3a404a',
      textMuted: '#5a616d',
      border: '#d2d6dc',
      borderStrong: '#7e8590',
      primary: '#183d32',
      primaryHover: '#245a47',
      primaryPressed: '#2f6f58',
      primaryText: '#fbf8f3',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 2. Forest Luxury (Deep Forest & Rich Cream)
  {
    id: 'forest_luxury',
    name: { th: 'ฟอเรสต์ ลักชัวรี', en: 'Forest Luxury' },
    category: { th: 'พรีเมียม โฮเทล & บูติก (Hospitality & Specialty)', en: 'Hospitality & Luxury Specialty' },
    tagline: { th: 'สีเขียวเข้มธรรมชาติลึกซึ้ง พื้นหลังครีมคลาสสิกระดับไฮเอนด์', en: 'Deep sanctuary forest and artisanal warm cream' },
    description: {
      th: 'ดีพฟอเรสต์เข้มข้นร่วมกับพื้นผิวครีมอบอุ่น ถ่ายทอดความหรูหรา สงบเงียบ เหมาะกับโรงแรมและร้านบูติกพรีเมียม',
      en: 'Deep sanctuary forest and warm cream surfaces, crafted for luxury hospitality, specialty cafes, and high-end retail.',
    },
    isDark: false,
    primary: '#0f2a22',
    primaryDark: '#081713',
    primaryLight: 'rgba(15, 42, 34, 0.08)',
    primaryGlow: 'rgba(15, 42, 34, 0.18)',
    background: '#f7f1e8',
    card: '#fbf8f3',
    cardHover: '#ede4d5',
    text: '#20242b',
    textMuted: '#5a616d',
    border: '#d2d6dc',
    borderHover: '#7e8590',
    buttonRadius: '14px',
    cardRadius: '18px',
    buttonStyle: 'luxury',
    badge: 'PREMIUM',
    swatches: ['#0f2a22', '#f7f1e8', '#e8894a', '#d5a64a'],
    semanticTokens: {
      bg: '#f7f1e8',
      surface: '#fbf8f3',
      surfaceRaised: '#fbf8f3',
      surfaceMuted: '#ede4d5',
      surfaceSelected: '#dcebe3',
      surfaceHover: '#eef5f1',
      text: '#20242b',
      textSecondary: '#3a404a',
      textMuted: '#5a616d',
      border: '#d2d6dc',
      borderStrong: '#7e8590',
      primary: '#0f2a22',
      primaryHover: '#183d32',
      primaryPressed: '#245a47',
      primaryText: '#fbf8f3',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 3. Enterprise Obsidian (Modern SaaS High-Tech Dark)
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
    semanticTokens: {
      bg: '#090D16',
      surface: '#0F172A',
      surfaceRaised: '#1E293B',
      surfaceMuted: '#1E293B',
      surfaceSelected: '#243038',
      surfaceHover: '#1E293B',
      text: '#F8FAFC',
      textSecondary: '#94A3B8',
      textMuted: '#94A3B8',
      border: '#1E293B',
      borderStrong: '#334155',
      primary: '#3B82F6',
      primaryHover: '#2563EB',
      primaryPressed: '#1D4ED8',
      primaryText: '#FFFFFF',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 4. Nordic Clean Slate (Minimalist Scandinavian Light)
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
    semanticTokens: {
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
      primary: '#2563EB',
      primaryHover: '#1D4ED8',
      primaryPressed: '#1E40AF',
      primaryText: '#FFFFFF',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 5. Royal Emerald Velvet (Organic Luxury / Gourmet & Spa)
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
    semanticTokens: {
      bg: '#F4FBF7',
      surface: '#FFFFFF',
      surfaceRaised: '#ECFDF5',
      surfaceMuted: '#D1FAE5',
      surfaceSelected: '#D1FAE5',
      surfaceHover: '#ECFDF5',
      text: '#064E3B',
      textSecondary: '#047857',
      textMuted: '#059669',
      border: '#D1FAE5',
      borderStrong: '#6EE7B7',
      primary: '#059669',
      primaryHover: '#047857',
      primaryPressed: '#065F46',
      primaryText: '#FFFFFF',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 6. Cyberpunk Neon Dusk (High-Energy / Electronic & Night Lounge)
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
    semanticTokens: {
      bg: '#0B0F19',
      surface: '#111827',
      surfaceRaised: '#1F2937',
      surfaceMuted: '#1F2937',
      surfaceSelected: '#164E63',
      surfaceHover: '#1F2937',
      text: '#F9FAFB',
      textSecondary: '#D1D5DB',
      textMuted: '#9CA3AF',
      border: '#1F2937',
      borderStrong: '#374151',
      primary: '#06B6D4',
      primaryHover: '#0891B2',
      primaryPressed: '#0E7490',
      primaryText: '#0B0F19',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 7. Sunset Terracotta & Amber (Artisan Warmth / Bakery, Cafe & Bistro)
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
    semanticTokens: {
      bg: '#FFFBF7',
      surface: '#FFFFFF',
      surfaceRaised: '#FFF7ED',
      surfaceMuted: '#FFEDD5',
      surfaceSelected: '#FED7AA',
      surfaceHover: '#FFF7ED',
      text: '#431407',
      textSecondary: '#7C2D12',
      textMuted: '#9A3412',
      border: '#FFEDD5',
      borderStrong: '#FDBA74',
      primary: '#EA580C',
      primaryHover: '#C2410C',
      primaryPressed: '#9A3412',
      primaryText: '#FFFFFF',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 8. Midnight Velvet Indigo (Executive Luxury / Watches & Fine Living)
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
    semanticTokens: {
      bg: '#0A0A14',
      surface: '#13132B',
      surfaceRaised: '#1E1E3F',
      surfaceMuted: '#1E1E3F',
      surfaceSelected: '#312E81',
      surfaceHover: '#1E1E3F',
      text: '#F8FAFC',
      textSecondary: '#CBD5E1',
      textMuted: '#A5B4FC',
      border: '#23234A',
      borderStrong: '#3B3B6D',
      primary: '#6366F1',
      primaryHover: '#4F46E5',
      primaryPressed: '#4338CA',
      primaryText: '#FFFFFF',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 9. Rose Luxury (Boutique Beauty & Luxury Retail)
  {
    id: 'rose_luxury',
    name: { th: 'โรส ลักชัวรี', en: 'Rose Luxury' },
    category: { th: 'พรีเมียม บิวตี้ (Beauty & Luxury)', en: 'Boutique Beauty & Luxury' },
    tagline: { th: 'สีชมพูโรสอ่อนหรูหรา สำหรับคลินิกและบิวตี้บูติก', en: 'Refined blush rose with warm neutral luxury' },
    description: {
      th: 'โทนสีโรสหรูหรา พื้นผิวเรียบเนียน เหมาะกับร้านเครื่องสำอาง บิวตี้ซาลอน และแฟชั่นบูติก',
      en: 'Soft rose-neutral tones with sophisticated contrast, ideal for cosmetics, beauty salons, and high-end boutiques.',
    },
    isDark: false,
    primary: '#be185d',
    primaryDark: '#9d174d',
    primaryLight: 'rgba(190, 24, 93, 0.08)',
    primaryGlow: 'rgba(190, 24, 93, 0.18)',
    background: '#fff1f2',
    card: '#ffffff',
    cardHover: '#ffe4e6',
    text: '#4c0519',
    textMuted: '#9f1239',
    border: '#fecdd3',
    borderHover: '#fda4af',
    buttonRadius: '14px',
    cardRadius: '18px',
    buttonStyle: 'luxury',
    badge: 'BOUTIQUE',
    swatches: ['#be185d', '#fff1f2', '#ffffff', '#4c0519'],
    semanticTokens: {
      bg: '#fff1f2',
      surface: '#ffffff',
      surfaceRaised: '#fff1f2',
      surfaceMuted: '#ffe4e6',
      surfaceSelected: '#fecdd3',
      surfaceHover: '#fff1f2',
      text: '#4c0519',
      textSecondary: '#881337',
      textMuted: '#9f1239',
      border: '#fecdd3',
      borderStrong: '#fb7185',
      primary: '#be185d',
      primaryHover: '#9d174d',
      primaryPressed: '#831843',
      primaryText: '#ffffff',
      ...SHARED_CTA_AND_STATUS,
    },
  },

  // 10. Classic Light (Timeless Neutral)
  {
    id: 'classic_light',
    name: { th: 'คลาสสิก ไลท์', en: 'Classic Light' },
    category: { th: 'คลาสสิก นิวทรัล (Classic Neutral)', en: 'Timeless Classic Neutral' },
    tagline: { th: 'เรียบง่าย ชัดเจน สบายตา มาตรฐานสากล', en: 'Timeless neutral workspace with crisp contrast' },
    description: {
      th: 'อินเทอร์เฟซสีขาวเทาคลาสสิก สบายตา อ่านง่าย เหมาะกับทุกธุรกิจค้าปลีกทั่วไป',
      en: 'Timeless neutral light interface with crisp readability, engineered for all general retail operations.',
    },
    isDark: false,
    primary: '#27272a',
    primaryDark: '#18181b',
    primaryLight: 'rgba(39, 39, 42, 0.08)',
    primaryGlow: 'rgba(39, 39, 42, 0.16)',
    background: '#f4f4f5',
    card: '#ffffff',
    cardHover: '#e4e4e7',
    text: '#18181b',
    textMuted: '#71717a',
    border: '#e4e4e7',
    borderHover: '#d4d4d8',
    buttonRadius: '10px',
    cardRadius: '14px',
    buttonStyle: 'minimal',
    badge: 'CLASSIC',
    swatches: ['#27272a', '#f4f4f5', '#ffffff', '#18181b'],
    semanticTokens: {
      bg: '#f4f4f5',
      surface: '#ffffff',
      surfaceRaised: '#fafafa',
      surfaceMuted: '#e4e4e7',
      surfaceSelected: '#d4d4d8',
      surfaceHover: '#f4f4f5',
      text: '#18181b',
      textSecondary: '#3f3f46',
      textMuted: '#71717a',
      border: '#e4e4e7',
      borderStrong: '#a1a1aa',
      primary: '#27272a',
      primaryHover: '#18181b',
      primaryPressed: '#09090b',
      primaryText: '#ffffff',
      ...SHARED_CTA_AND_STATUS,
    },
  },
];

export function resolveLegacyPresetId(id: string): string {
  const match = THEME_PRESETS.find((p) => p.id === id);
  if (match) return id;

  switch (id) {
    case 'enterprise_blue':
    case 'modern':
    case 'minimal':
    case 'ocean':
      return 'nordic_slate';
    case 'deep_obsidian':
    case 'dark_elegant':
      return 'enterprise_obsidian';
    case 'emerald':
      return 'royal_emerald';
    case 'cyberpunk':
      return 'cyberpunk_neon';
    case 'sunset':
      return 'sunset_terracotta';
    case 'lavender':
      return 'midnight_indigo';
    default:
      return 'prodx_signature';
  }
}
