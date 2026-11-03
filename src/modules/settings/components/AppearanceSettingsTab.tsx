import React, { useState } from 'react';
import {
  Palette,
  Sun,
  Moon,
  Sparkles,
  Check,
  Tv,
  Monitor,
  ExternalLink,
  Upload,
  Trash2,
  Image as ImageIcon,
  RotateCcw,
  Layers,
  Crown,
  Zap,
  Sliders,
  Eye,
  CheckCircle2,
  ShieldCheck,
  Tag,
  ArrowRight,
  Smartphone,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { GraphicIcon } from '../../../components/common/GraphicIcon';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme, THEME_PRESETS, ThemePreset } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { CustomerDisplayConfigState } from '../types';
import { CustomerDisplayLauncherModal } from '../../../components/customerDisplay/CustomerDisplayLauncherModal';

export interface AppearanceSettingsTabProps {
  cfdConfig: CustomerDisplayConfigState;
  onChangeCfdField: <K extends keyof CustomerDisplayConfigState>(
    field: K,
    value: CustomerDisplayConfigState[K]
  ) => void;
  onClearThemeLocalStorageAndReset?: () => void;
}

export const AppearanceSettingsTab: React.FC<AppearanceSettingsTabProps> = ({
  cfdConfig,
  onChangeCfdField,
  onClearThemeLocalStorageAndReset,
}) => {
  const { language } = useLanguage();
  const {
    theme,
    themeMode,
    setThemeMode,
    activePresetId,
    currentPreset,
    setPreset,
    customAccentColor,
    setCustomAccentColor,
    customLogo,
    setCustomLogo,
    resetAllThemeSettings,
  } = useTheme();
  const { addToast } = useToast();

  const [isCfdModalOpen, setIsCfdModalOpen] = useState(false);
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);

  React.useEffect(() => {
    const presetToApply = THEME_PRESETS.find((p) => p.id === (previewPresetId || activePresetId)) || currentPreset;
    const root = document.documentElement;
    root.style.setProperty('--primary-color', presetToApply.primary);
    root.style.setProperty('--primary-dark', presetToApply.primaryDark);
    root.style.setProperty('--primary-light', presetToApply.primaryLight);
    root.style.setProperty('--primary-glow', presetToApply.primaryGlow);
    root.style.setProperty('--bg-color', presetToApply.background);
    root.style.setProperty('--card-color', presetToApply.card);
    root.style.setProperty('--card-hover', presetToApply.cardHover);
    root.style.setProperty('--text-color', presetToApply.text);
    root.style.setProperty('--text-muted', presetToApply.textMuted);
    root.style.setProperty('--border-color', presetToApply.border);
  }, [previewPresetId, activePresetId, currentPreset]);

  const handleLaunchDualMonitor = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=customer-display`;
    const newWindow = window.open(
      url,
      'ProdxCustomerDisplay',
      'width=1080,height=720,menubar=no,toolbar=no,location=no,status=no'
    );

    if (newWindow) {
      addToast({
        title: language === 'th' ? 'เปิดจอฝั่งลูกค้าสำเร็จ' : 'Customer Display Opened',
        message:
          language === 'th'
            ? 'ลากหน้าต่างนี้ไปยังจอมอนิเตอร์ที่ 2 แล้วกด F11 ขยายเต็มจอ'
            : 'Move the window to your 2nd screen and press F11 for fullscreen mode.',
        type: 'success',
      });
    } else {
      addToast({
        title: language === 'th' ? 'บราวเซอร์บล็อกป็อปอัป' : 'Popup Blocked',
        message:
          language === 'th'
            ? 'โปรดอนุญาต Pop-up บนเบราว์เซอร์เพื่อเปิดหน้าต่างจอฝั่งลูกค้า'
            : 'Please allow popups in your browser to launch dual display.',
        type: 'warning',
      });
    }
  };

  const handlePresetSelect = (preset: ThemePreset) => {
    setPreset(preset.id);
    addToast({
      title: language === 'th' ? 'ปรับใช้ธีมสำเร็จ (1-Click Active)' : 'Theme Preset Activated',
      message:
        language === 'th'
          ? `เปิดใช้งานธีม "${preset.name[language]}" ทั้งระบบเรียบร้อย`
          : `Switched system aesthetics to "${preset.name[language]}"`,
      type: 'success',
    });
  };

  return (
    <div className="space-y-6">
      {/* Main Theme Header Card */}
      <Card className="border border-border/80 shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="bg-card/70 border-b border-border/60 py-4 px-5 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3 min-w-0">
              <GraphicIcon
                icon={Palette}
                color="primary"
                variant="glow"
                size="md"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black tracking-tight text-text">
                    {language === 'th'
                      ? 'ชุดธีมระบบระดับองค์กร (Global Theme Presets)'
                      : 'Global Enterprise Theme Presets'}
                  </h2>
                  <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                    6 Presets
                  </Badge>
                </div>
                <p className="text-xs text-text/60 mt-0.5">
                  {language === 'th'
                    ? 'ปรับแต่งสไตล์ สีหลัก สีพื้น สีปุ่ม และความรู้สึกทั้งระบบเพียง 1 คลิก'
                    : 'Curated world-class aesthetic systems for seamless 1-click store transformation.'}
                </p>
              </div>
            </div>

            {/* Quick Light/Dark/System Mode Segmented Switcher */}
            <div
              className="p-1 rounded-xl border border-border bg-background/90 flex items-center gap-1 shadow-2xs self-start sm:self-auto"
              role="group"
              aria-label="Theme mode switcher"
            >
              <button
                type="button"
                onClick={() => {
                  setThemeMode('light');
                  addToast({
                    title: language === 'th' ? 'โหมดสว่าง (Light)' : 'Light Mode Active',
                    message: language === 'th' ? 'ปรับเปลี่ยนการแสดงผลเป็นโหมดสว่าง' : 'Switched to Light mode.',
                    type: 'info',
                  });
                }}
                className={`h-7 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer select-none ${
                  themeMode === 'light'
                    ? 'bg-card text-text border border-border shadow-xs'
                    : 'text-text/60 hover:text-text hover:bg-card/40'
                }`}
              >
                <Sun className={`h-3.5 w-3.5 ${themeMode === 'light' ? 'text-amber-500' : 'text-text/50'}`} />
                <span>{language === 'th' ? 'สว่าง' : 'Light'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setThemeMode('dark');
                  addToast({
                    title: language === 'th' ? 'โหมดมืด (Dark)' : 'Dark Mode Active',
                    message: language === 'th' ? 'ปรับเปลี่ยนการแสดงผลเป็นโหมดมืด' : 'Switched to Dark mode.',
                    type: 'info',
                  });
                }}
                className={`h-7 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer select-none ${
                  themeMode === 'dark'
                    ? 'bg-card text-text border border-border shadow-xs'
                    : 'text-text/60 hover:text-text hover:bg-card/40'
                }`}
              >
                <Moon className={`h-3.5 w-3.5 ${themeMode === 'dark' ? 'text-primary' : 'text-text/50'}`} />
                <span>{language === 'th' ? 'มืด' : 'Dark'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setThemeMode('system');
                  addToast({
                    title: language === 'th' ? 'โหมดตามระบบ (System)' : 'System Mode Active',
                    message: language === 'th' ? 'ปรับเปลี่ยนตามการตั้งค่าของ OS' : 'Adapts automatically to OS preferences.',
                    type: 'info',
                  });
                }}
                className={`h-7 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer select-none ${
                  themeMode === 'system'
                    ? 'bg-card text-text border border-border shadow-xs'
                    : 'text-text/60 hover:text-text hover:bg-card/40'
                }`}
              >
                <Monitor className={`h-3.5 w-3.5 ${themeMode === 'system' ? 'text-primary' : 'text-text/50'}`} />
                <span>{language === 'th' ? 'อัตโนมัติ' : 'Auto'}</span>
              </button>
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-5 sm:p-6 space-y-6">
          {/* Active Preset Banner Indicator */}
          <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl border border-white/20 shadow-xs flex items-center justify-center shrink-0"
                style={{ backgroundColor: currentPreset.primary }}
              >
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    {language === 'th' ? 'ธีมที่ใช้งานอยู่ขณะนี้' : 'Currently Active Preset'}
                  </span>
                  <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                    {currentPreset.badge}
                  </Badge>
                </div>
                <h3 className="text-base font-black text-text">
                  {currentPreset.name[language]}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-auto">
              <span className="text-xs text-text/60 font-medium hidden md:inline">
                {currentPreset.tagline[language]}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (onClearThemeLocalStorageAndReset) {
                    onClearThemeLocalStorageAndReset();
                  } else {
                    resetAllThemeSettings();
                  }
                  addToast({
                    title: language === 'th' ? 'รีเซ็ตธีมเป็นค่าเริ่มต้น' : 'Theme Reset to Default',
                    message: language === 'th' ? 'ล้างค่า localStorage และคืนค่าธีม Enterprise Obsidian สำเร็จ' : 'Cleared localStorage keys and reverted to Enterprise Obsidian.',
                    type: 'success',
                  });
                }}
                className="h-9 px-3 text-xs font-bold gap-1.5 border-border hover:bg-card"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {language === 'th' ? 'รีเซ็ตเป็นค่าเริ่มต้น' : 'Reset to Default'}
              </Button>
            </div>
          </div>

          {/* 6 Global Theme Presets Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-text uppercase tracking-wider">
                {language === 'th' ? 'เลือกพรีเซ็ตธีม (คลิกเดียวเปลี่ยนทันที)' : 'Select Theme Preset (1-Click Instant Apply)'}
              </label>
              <span className="text-xs text-text/50 font-mono">
                6 Pro Themes
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {THEME_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id;

                return (
                  <div
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset)}
                    onMouseEnter={() => setPreviewPresetId(preset.id)}
                    onMouseLeave={() => setPreviewPresetId(null)}
                    className={`group relative p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between gap-4 overflow-hidden select-none hover:scale-[1.01] active:scale-[0.99] ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/30 bg-card shadow-md'
                        : 'border-border bg-card/60 hover:bg-card hover:border-border/90 shadow-2xs'
                    }`}
                  >
                    {/* Top Palette Swatches and Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-background border border-border">
                        {preset.swatches.map((colorHex, sIdx) => (
                          <div
                            key={sIdx}
                            className="w-5 h-5 rounded-lg border border-border/50 shadow-2xs"
                            style={{ backgroundColor: colorHex }}
                            title={colorHex}
                          />
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={isSelected ? 'primary' : 'neutral'}
                          size="sm"
                          className="font-mono text-[9px] font-bold px-2 py-0.5"
                        >
                          {preset.badge}
                        </Badge>
                        {isSelected ? (
                          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
                            <Check className="h-3.5 w-3.5 stroke-[3px]" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border border-border/80 flex items-center justify-center text-text/30 group-hover:text-primary group-hover:border-primary transition-colors">
                            <ArrowRight className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Preset Info */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-text/50">
                        {preset.category[language]}
                      </div>
                      <h4 className="text-sm font-black text-text group-hover:text-primary transition-colors">
                        {preset.name[language]}
                      </h4>
                      <p className="text-xs font-semibold text-text/70 line-clamp-1">
                        {preset.tagline[language]}
                      </p>
                      <p className="text-[11px] text-text/50 line-clamp-2 mt-1 leading-relaxed">
                        {preset.description[language]}
                      </p>
                    </div>

                    {/* Card-Based Visual Preview Thumbnail */}
                    <div 
                      className="w-full rounded-xl p-3 flex flex-col justify-between border shadow-2xs transition-all relative overflow-hidden"
                      style={{
                        backgroundColor: preset.background,
                        borderColor: preset.border,
                        color: preset.text,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.primary }} />
                          <span className="text-[10px] font-extrabold tracking-tight" style={{ color: preset.text }}>
                            {preset.name[language].split(' ')[0]} POS UI
                          </span>
                        </div>
                        <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: preset.primaryLight, color: preset.primary }}>
                          Live Preview
                        </span>
                      </div>
                      <div 
                        className="p-2 rounded-lg border flex items-center justify-between"
                        style={{
                          backgroundColor: preset.card,
                          borderColor: preset.border,
                        }}
                      >
                        <div>
                          <div className="text-[9px] font-bold" style={{ color: preset.text }}>
                            {language === 'th' ? 'รวมสุทธิ ฿450' : 'Total ฿450'}
                          </div>
                          <div className="text-[8px]" style={{ color: preset.textMuted }}>
                            VAT 7% Included
                          </div>
                        </div>
                        <div 
                          className="px-2.5 py-1 text-[9px] font-bold text-white shadow-2xs"
                          style={{ backgroundColor: preset.primary, borderRadius: preset.buttonRadius }}
                        >
                          {language === 'th' ? 'ชำระเงิน' : 'Pay'}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Attributes Bar */}
                    <div className="pt-3 border-t border-border/60 flex items-center justify-between text-[10px] font-mono text-text/50">
                      <span className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${preset.isDark ? 'bg-indigo-400' : 'bg-amber-400'}`} />
                        <span>{preset.isDark ? 'Dark Base' : 'Light Base'}</span>
                      </span>
                      <span>Radius: {preset.buttonRadius}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Theme Component Showcase (Interactive Preview) */}
          <div className="p-5 rounded-2xl border border-border bg-card/80 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-text">
                  {language === 'th' ? 'การแสดงผลตัวอย่างคอมโพเนนต์สด (Live Component Harmony Preview)' : 'Live Theme Harmony Showcase'}
                </h4>
              </div>
              <span className="text-[10px] font-mono text-text/50">
                Token Preview
              </span>
            </div>

            {/* Interactive Mock Widgets Box */}
            <div className="p-4 rounded-xl border border-border/80 bg-background space-y-4">
              {/* Row 1: Buttons */}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" size="sm" leftIcon={<Zap className="h-3.5 w-3.5" />}>
                  {language === 'th' ? 'ปุ่มหลัก (Primary)' : 'Primary Action'}
                </Button>
                <Button variant="secondary" size="sm">
                  {language === 'th' ? 'ปุ่มรอง (Secondary)' : 'Secondary'}
                </Button>
                <Button variant="outline" size="sm">
                  {language === 'th' ? 'เส้นขอบ (Outline)' : 'Outline'}
                </Button>
                <Button variant="danger" size="sm">
                  {language === 'th' ? 'ปุ่มเตือน (Danger)' : 'Danger'}
                </Button>
              </div>

              {/* Row 2: Badges & Tags */}
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge variant="primary" size="md" dot>
                  {language === 'th' ? 'สถานะพร้อมใช้งาน' : 'System Ready'}
                </Badge>
                <Badge variant="success" size="md">
                  {language === 'th' ? 'ชำระแล้ว ฿1,250.00' : 'Paid ฿1,250.00'}
                </Badge>
                <Badge variant="warning" size="md">
                  {language === 'th' ? 'รออนุมัติ PIN' : 'Pending PIN'}
                </Badge>
                <Badge variant="purple" size="md">
                  {language === 'th' ? 'VIP Gold' : 'VIP Gold Tier'}
                </Badge>
                <Badge variant="neutral" size="md">
                  {language === 'th' ? 'สาขา BKK-01' : 'Branch BKK-01'}
                </Badge>
              </div>

              {/* Row 3: Mock Input & Mini Card */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div className="text-[10px] uppercase font-bold text-text/50">
                    {language === 'th' ? 'ช่องกรอกข้อมูล' : 'Form Input Field'}
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={language === 'th' ? 'ตัวอย่างข้อความระบบ POS' : 'PRODX Enterprise POS System'}
                    className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs text-text font-medium"
                  />
                </div>

                <div className="p-3 rounded-xl border border-border bg-card flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-text/50">
                      {language === 'th' ? 'ยอดรวมสุทธิ' : 'Total Net Amount'}
                    </div>
                    <div className="text-sm font-black text-primary font-mono">
                      ฿ 4,890.00
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-text/50">VAT 7% Included</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Accent Color Customization */}
          <div className="pt-4 border-t border-border/60 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold text-text uppercase tracking-wider">
                  {language === 'th' ? 'ปรับแต่งสีเน้นเพิ่มเติม (Custom Accent Override)' : 'Custom Accent Color Override'}
                </label>
                <span className="text-[11px] text-text/50">
                  {language === 'th'
                    ? 'กำหนดสีไฮไลท์เฉพาะสำหรับแบรนด์ของคุณ (จะแทนที่สีหลักของธีม)'
                    : 'Override primary button & badge accent while keeping preset canvas tones.'}
                </span>
              </div>
              {customAccentColor && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomAccentColor(null);
                    addToast({
                      title: language === 'th' ? 'คืนค่าสีหลัก' : 'Accent Reset',
                      message: language === 'th' ? 'กลับไปใช้สีมาตรฐานของธีมปัจจุบัน' : 'Reverted to theme default accent.',
                      type: 'info',
                    });
                  }}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{language === 'th' ? 'รีเซ็ตกลับเป็นสีธีม' : 'Reset to Theme Accent'}</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Dynamic Color Input */}
              <div className="relative w-10 h-9 rounded-xl border border-border overflow-hidden cursor-pointer shrink-0 shadow-xs">
                <input
                  type="color"
                  value={customAccentColor || currentPreset.primary}
                  onChange={(e) => setCustomAccentColor(e.target.value)}
                  className="absolute inset-0 w-full h-full scale-150 cursor-pointer border-0 p-0"
                />
              </div>

              {/* Fast Presets Swatches */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { hex: '#3B82F6', name: 'Electric Sapphire' },
                  { hex: '#2563EB', name: 'Royal Ocean' },
                  { hex: '#059669', name: 'Emerald Jade' },
                  { hex: '#06B6D4', name: 'Cyber Cyan' },
                  { hex: '#EA580C', name: 'Sunset Terracotta' },
                  { hex: '#6366F1', name: 'Cosmic Indigo' },
                  { hex: '#EC4899', name: 'Neon Rose' },
                  { hex: '#D97706', name: 'Golden Amber' },
                ].map((presetColor) => (
                  <button
                    key={presetColor.hex}
                    type="button"
                    onClick={() => {
                      setCustomAccentColor(presetColor.hex);
                      addToast({
                        title: language === 'th' ? 'กำหนดสีเน้นแล้ว' : 'Accent Color Selected',
                        message: `${presetColor.name} (${presetColor.hex})`,
                        type: 'success',
                      });
                    }}
                    className={`w-8 h-8 rounded-full border relative flex items-center justify-center transition-all cursor-pointer ${
                      customAccentColor === presetColor.hex
                        ? 'ring-2 ring-offset-2 ring-primary border-transparent scale-110 shadow-sm'
                        : 'border-border/60 hover:scale-105'
                    }`}
                    style={{ backgroundColor: presetColor.hex }}
                    title={presetColor.name}
                  >
                    {customAccentColor === presetColor.hex && (
                      <Check className="h-4 w-4 text-white stroke-[3px]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Store Logo Branding */}
          <div className="pt-4 border-t border-border/60 space-y-3">
            <label className="block text-xs font-bold text-text uppercase tracking-wider">
              {language === 'th' ? 'ภาพโลโก้แบรนด์ร้านค้า (Store Logo Branding)' : 'Store Logo Branding'}
            </label>

            <div className="flex items-center gap-4 p-4 rounded-xl border border-border/80 bg-card/60">
              <div className="w-16 h-16 rounded-xl border border-dashed border-border flex items-center justify-center bg-background overflow-hidden shrink-0 shadow-xs">
                {customLogo ? (
                  <img
                    src={customLogo}
                    alt="Custom Store Logo"
                    className="w-full h-full object-contain p-1"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-xs text-text/40 text-center font-bold px-1">
                    PRODX
                  </div>
                )}
              </div>

              <div className="space-y-1.5 flex-1">
                <div className="text-xs font-bold text-text">
                  {customLogo
                    ? (language === 'th' ? 'ใช้งานโลโก้กำหนดเอง' : 'Custom Brand Logo Active')
                    : (language === 'th' ? 'ใช้งานโลโก้มาตรฐาน PRODX POS' : 'Default PRODX POS Logo Active')}
                </div>
                <div className="text-[11px] text-text/50">
                  {language === 'th'
                    ? 'รองรับไฟล์ PNG, JPG, SVG (แนะนำพื้นหลังโปร่งใส อัตราส่วน 1:1 หรือ 4:1)'
                    : 'Supported formats: PNG, JPG, SVG. Recommended transparent background.'}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <label className="inline-flex items-center justify-center h-8 px-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs cursor-pointer transition shadow-xs gap-1.5 active:scale-95">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{language === 'th' ? 'อัปโหลดโลโก้ใหม่' : 'Upload Logo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const result = event.target?.result as string;
                            setCustomLogo(result);
                            addToast({
                              title: language === 'th' ? 'อัปโหลดโลโก้สำเร็จ' : 'Custom Logo Saved',
                              message: language === 'th'
                                ? 'โลโก้ถูกนำไปใช้ในส่วนหัวของแอปและใบเสร็จแล้ว'
                                : 'Brand logo updated across POS and thermal receipts.',
                              type: 'success',
                            });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>

                  {customLogo && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setCustomLogo(null);
                        addToast({
                          title: language === 'th' ? 'ลบโลโก้ร้านค้าแล้ว' : 'Logo Removed',
                          message: language === 'th' ? 'คืนค่าไปใช้โลโก้มาตรฐาน' : 'Reverted to default logo.',
                          type: 'info',
                        });
                      }}
                      className="h-8 text-xs rounded-xl"
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      {language === 'th' ? 'ลบภาพ' : 'Remove'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Factory Reset Branding */}
          <div className="pt-4 border-t border-border/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400">
                  {language === 'th' ? 'คืนค่าเริ่มต้นโรงงาน (Reset All Visual Theme Settings)' : 'Reset to Factory Defaults'}
                </h4>
                <p className="text-[11px] text-rose-600/70 dark:text-rose-400/70 mt-0.5">
                  {language === 'th' ? 'ล้างการตั้งค่าธีม สี และโลโก้ที่ปรับแต่งทั้งหมดกลับสู่ค่าเริ่มต้น' : 'Clears all custom branding, accent colors, and resets to default theme.'}
                </p>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="w-full sm:w-auto shrink-0 font-bold whitespace-nowrap rounded-xl"
                onClick={() => {
                  resetAllThemeSettings();
                  addToast({
                    title: language === 'th' ? 'คืนค่าเริ่มต้นสำเร็จ' : 'Factory Reset Complete',
                    message: language === 'th' ? 'การตั้งค่ารูปลักษณ์ถูกล้างและกลับเป็นค่าเดิมแล้ว' : 'All appearance settings have been restored to default.',
                    type: 'success',
                  });
                }}
              >
                {language === 'th' ? 'คืนค่าเริ่มต้นเป็นค่าโรงงาน' : 'Reset to Factory Defaults'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Customer-Facing Display (CFD) Settings Card */}
      <Card className="border border-border/80 shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="bg-card/70 border-b border-border/60 py-4 px-5 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 w-full">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <GraphicIcon
                icon={Tv}
                color="cyan"
                variant="badge"
                size="md"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-text">
                  {language === 'th' ? 'หน้าจอฝั่งลูกค้า (Customer-Facing Display - CFD)' : 'Customer-Facing Display (CFD)'}
                </h3>
                <p className="text-[11px] text-text/50">
                  {language === 'th'
                    ? 'กำหนดค่าสำหรับจอมอนิเตอร์ที่ 2 แสดงรายการสแกน ยอดชำระ และ QR พร้อมเพย์'
                    : 'Secondary customer monitor configuration with real-time BroadcastChannel sync.'}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleLaunchDualMonitor}
              className="w-full sm:w-auto rounded-xl font-bold text-xs shrink-0 whitespace-nowrap"
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'เปิดหน้าต่างจอ 2 (Dual Screen)' : 'Launch 2nd Screen'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-5 sm:p-6 space-y-5">
          {/* CFD Enable Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/60">
            <div>
              <div className="font-bold text-text text-xs">
                {language === 'th' ? 'เปิดใช้งานระบบส่งข้อมูลไปยังจอฝั่งลูกค้า (Enable CFD Sync)' : 'Enable Dual-Screen CFD Sync'}
              </div>
              <div className="text-[11px] text-text/50 mt-0.5">
                {language === 'th'
                  ? 'กระจายสถานะตะกร้าสินค้าแบบเรียลไทม์ผ่าน BroadcastChannel ไปยังทุกแท็บหรือหน้าต่าง CFD'
                  : 'Continuously publishes cart lines, totals, discounts, and payment QR states to client displays.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cfdConfig.enabled}
              aria-label={language === 'th' ? 'เปิดใช้งานระบบส่งข้อมูลไปยังจอฝั่งลูกค้า' : 'Enable Dual-Screen CFD Sync'}
              onClick={() => {
                const next = !cfdConfig.enabled;
                onChangeCfdField('enabled', next);
                addToast({
                  title: language === 'th' ? 'อัปเดตระบบ CFD แล้ว' : 'CFD Preference Updated',
                  message: next
                    ? (language === 'th' ? 'เปิดใช้งานจอแสดงผลฝั่งลูกค้า' : 'Customer Display enabled')
                    : (language === 'th' ? 'ปิดใช้งานจอแสดงผลฝั่งลูกค้า' : 'Customer Display disabled'),
                  type: 'info',
                });
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  const next = !cfdConfig.enabled;
                  onChangeCfdField('enabled', next);
                }
              }}
              className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                cfdConfig.enabled ? 'bg-primary' : 'bg-border dark:bg-background'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  cfdConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* CFD Messages & Screensaver Banner */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'ข้อความต้อนรับตอนพักหน้าจอ (Welcome Headline)' : 'Idle Welcome Headline'}
              </label>
              <input
                type="text"
                value={cfdConfig.welcomeMessage}
                onChange={(e) => onChangeCfdField('welcomeMessage', e.target.value)}
                placeholder="e.g. ยินดีต้อนรับสู่ PRODX Store"
                className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'คำโปรยรอง (Secondary Slogan)' : 'Secondary Slogan'}
              </label>
              <input
                type="text"
                value={cfdConfig.subMessage}
                onChange={(e) => onChangeCfdField('subMessage', e.target.value)}
                placeholder="e.g. คุณภาพระดับพรีเมียม บริการด้วยใจ"
                className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
              />
            </div>
          </div>

          {/* Banner Image URL for Screensaver */}
          <div className="space-y-1.5 pt-2 border-t border-border/60">
            <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
              {language === 'th' ? 'URL รูปภาพโปรโมชันสไลด์พักหน้าจอ (Screensaver Promo Banner)' : 'Screensaver Promo Banner Image URL'}
            </label>
            <input
              type="url"
              value={cfdConfig.bannerImageUrl}
              onChange={(e) => onChangeCfdField('bannerImageUrl', e.target.value)}
              placeholder="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80"
              className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
            />
            <p className="text-[10px] text-text/50">
              {language === 'th'
                ? 'รูปภาพนี้จะแสดงบนจอฝั่งลูกค้าขณะไม่มีการสแกนสินค้าเพื่อโปรโมตแคมเปญ'
                : 'Displayed on customer screen when idle to advertise special promotions.'}
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Live Multi-Display Simulation (Enterprise Grade) */}
      <Card className="border border-border/80 shadow-lg rounded-2xl overflow-hidden bg-[#07111f] text-white">
        <CardHeader className="bg-white/5 border-b border-white/10 py-5 px-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary text-white shadow-glow">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">
                {language === 'th' ? 'จำลองการแสดงผลข้ามอุปกรณ์ (Live Multi-Display Simulation)' : 'Live Multi-Display Simulation'}
              </h3>
              <p className="text-xs text-white/50 mt-0.5">
                {language === 'th' ? 'ตรวจสอบสไตล์และแบรนด์ของคุณบนหน้าจอ POS ทุกรูปแบบ' : 'Audit your brand and theme harmony across all hardware form factors.'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* 1. Desktop POS Mockup */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">
                <Monitor className="h-3 w-3" />
                <span>Stationary Desktop POS</span>
              </div>
              <div className="aspect-video w-full rounded-2xl border-4 border-[#1e293b] bg-[#0f172a] relative overflow-hidden shadow-2xl group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                {/* Mock Desktop UI */}
                <div className="absolute inset-0 flex flex-col scale-[0.3] origin-top-left w-[333%] h-[333%] pointer-events-none">
                   <div className="h-20 w-full border-b border-white/10 flex items-center px-8" style={{ backgroundColor: currentPreset.card }}>
                      <div className="w-12 h-12 rounded-xl" style={{ backgroundColor: currentPreset.primary }} />
                      <div className="ml-4 h-6 w-64 rounded bg-white/10" />
                      <div className="ml-auto flex gap-4">
                         <div className="w-40 h-10 rounded-xl bg-white/5 border border-white/10" />
                         <div className="w-12 h-12 rounded-xl bg-primary/20" />
                      </div>
                   </div>
                   <div className="flex-1 flex p-8 gap-8">
                      <div className="w-24 h-full rounded-2xl bg-white/5 border border-white/10" />
                      <div className="flex-1 space-y-8">
                         <div className="grid grid-cols-4 gap-6">
                            {[1,2,3,4].map(i => <div key={i} className="h-40 rounded-3xl" style={{ backgroundColor: currentPreset.card, border: `1px solid ${currentPreset.border}` }} />)}
                         </div>
                         <div className="h-96 rounded-3xl" style={{ backgroundColor: currentPreset.card, border: `1px solid ${currentPreset.border}` }} />
                      </div>
                   </div>
                </div>
                <div className="absolute bottom-0 inset-x-0 h-1 bg-[#1e293b]" />
              </div>
              <div className="text-center text-[10px] font-bold text-white/30">1920 x 1080 Terminal</div>
            </div>

            {/* 2. Tablet / iPad Mockup */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">
                <Tv className="h-3 w-3" />
                <span>Mobile Tablet POS</span>
              </div>
              <div className="aspect-[4/3] w-full rounded-[2.5rem] border-8 border-[#1e293b] bg-[#0f172a] relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
                {/* Mock Tablet UI */}
                <div className="absolute inset-0 flex flex-col scale-[0.4] origin-top-left w-[250%] h-[250%] pointer-events-none">
                   <div className="h-24 w-full flex items-center px-10 gap-6" style={{ backgroundColor: currentPreset.card }}>
                      <div className="w-16 h-16 rounded-2xl" style={{ backgroundColor: currentPreset.primary }} />
                      <div className="flex-1 h-8 rounded-full bg-white/10" />
                      <div className="w-16 h-16 rounded-2xl bg-primary/20" />
                   </div>
                   <div className="p-10 grid grid-cols-2 gap-8">
                      <div className="h-80 rounded-[3rem]" style={{ backgroundColor: currentPreset.card, border: `2px solid ${currentPreset.border}` }} />
                      <div className="h-80 rounded-[3rem]" style={{ backgroundColor: currentPreset.card, border: `2px solid ${currentPreset.border}` }} />
                      <div className="h-80 rounded-[3rem] col-span-2" style={{ backgroundColor: currentPreset.primary }} />
                   </div>
                </div>
                {/* Home indicator */}
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-32 h-1 rounded-full bg-white/20" />
              </div>
              <div className="text-center text-[10px] font-bold text-white/30">10.5" Retina Display</div>
            </div>

            {/* 3. Smartphone Mockup */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">
                <Smartphone className="h-3 w-3" />
                <span>Quick Admin Mobile</span>
              </div>
              <div className="aspect-[9/19] w-[180px] mx-auto rounded-[3rem] border-[10px] border-[#1e293b] bg-[#0f172a] relative overflow-hidden shadow-2xl">
                <div className="absolute top-0 inset-x-0 h-7 flex justify-center items-center">
                   <div className="w-20 h-4 bg-[#1e293b] rounded-b-2xl" />
                </div>
                {/* Mock Mobile UI */}
                <div className="absolute inset-0 pt-8 flex flex-col pointer-events-none">
                   <div className="p-5 space-y-4">
                      <div className="w-12 h-12 rounded-2xl mx-auto shadow-lg" style={{ backgroundColor: currentPreset.primary }} />
                      <div className="h-4 w-3/4 bg-white/20 rounded-full mx-auto" />
                      <div className="space-y-3 pt-4">
                         {[1,2,3,4].map(i => (
                            <div key={i} className="h-14 rounded-2xl flex items-center px-4 gap-3" style={{ backgroundColor: currentPreset.card, border: `1px solid ${currentPreset.border}` }}>
                               <div className="w-6 h-6 rounded-lg bg-white/5" />
                               <div className="flex-1 h-3 rounded-full bg-white/10" />
                            </div>
                         ))}
                      </div>
                      <div className="mt-8 h-12 w-full rounded-2xl shadow-glow" style={{ backgroundColor: currentPreset.primary }} />
                   </div>
                </div>
                {/* Home indicator */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full bg-white/20" />
              </div>
              <div className="text-center text-[10px] font-bold text-white/30">6.7" OLED Smartphone</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {isCfdModalOpen && (
        <CustomerDisplayLauncherModal
          isOpen={isCfdModalOpen}
          onClose={() => setIsCfdModalOpen(false)}
        />
      )}
    </div>
  );
};
