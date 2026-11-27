import React, { useRef } from 'react';
import { useTheme, THEME_PRESETS, ThemePreset } from '../../context/ThemeContext';
import { Palette, Check, Image as ImageIcon, Trash2, Upload, RotateCcw, Sparkles } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export const ThemePicker: React.FC = () => {
  const {
    activePresetId,
    setPreset,
    customAccentColor,
    setCustomAccentColor,
    customLogo,
    setCustomLogo,
  } = useTheme();
  const { language } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCustomLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResetAccent = () => {
    setCustomAccentColor(null);
  };

  const handleResetLogo = () => {
    setCustomLogo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const SWATCHES = [
    { hex: '#3B82F6', label: 'Electric Sapphire' },
    { hex: '#2563EB', label: 'Royal Ocean' },
    { hex: '#059669', label: 'Emerald Jade' },
    { hex: '#06B6D4', label: 'Cyber Cyan' },
    { hex: '#EA580C', label: 'Sunset Terracotta' },
    { hex: '#6366F1', label: 'Cosmic Indigo' },
    { hex: '#EC4899', label: 'Neon Rose' },
    { hex: '#D97706', label: 'Golden Amber' },
  ];

  return (
    <div className="space-y-6">
      {/* Preset Themes List */}
      <div className="p-5 rounded-2xl border border-border border-crisp bg-card shadow-2xs">
        <div className="flex items-center justify-between mb-4 border-b border-border border-crisp pb-3">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-black text-text">
                {language === 'th' ? 'โมเดิร์นดีไซน์ & พรีเซตธีมระบบ 6 แบบ' : 'Global 6-Preset Theme System'}
              </h3>
              <p className="text-[11px] text-text/60 mt-0.5">
                {language === 'th' 
                  ? 'เปลี่ยนรูปแบบ สีสัน และดีไซน์ระบบทั้งหมดได้ทันทีเพียง 1 คลิก' 
                  : 'Instantly transform your POS layout, colors, and styling with 1-click presets.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {THEME_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id && !customAccentColor;
            return (
              <button
                key={preset.id}
                onClick={() => {
                  setPreset(preset.id);
                  handleResetAccent(); // reset custom override when preset is selected
                }}
                className={`group relative p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer overflow-hidden flex flex-col justify-between gap-3 ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-2xs ring-1 ring-primary'
                    : 'border-border bg-background/50 hover:border-primary/50 hover:scale-[1.01]'
                }`}
              >
                {/* Preset Swatches Preview */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-card border border-border">
                    {preset.swatches.map((color, sIdx) => (
                      <div
                        key={sIdx}
                        className="w-4 h-4 rounded-md border border-border/40"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded-md bg-card text-text/60 border border-border">
                      {preset.badge}
                    </span>
                    {isActive && (
                      <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Title & Tagline */}
                <div className="space-y-0.5">
                  <span className="block text-xs font-black text-text group-hover:text-primary transition-colors">
                    {preset.name[language]}
                  </span>
                  <span className="block text-[10px] font-semibold text-text/60 line-clamp-1">
                    {preset.tagline[language]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Accent Color & Logo Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Custom Accent Color Override */}
        <div className="p-5 rounded-2xl border border-border border-crisp bg-card shadow-2xs space-y-4">
          <div>
            <h4 className="text-xs font-extrabold text-text uppercase tracking-wider">
              {language === 'th' ? 'ปรับแต่งโทนสีระบบ (Custom Accent Color)' : 'Custom Accent Color Override'}
            </h4>
            <p className="text-[11px] text-text/60 mt-1">
              {language === 'th'
                ? 'เลือกสีโปรดที่เหมาะกับแบรนด์ร้านค้าของคุณ สีจะเปลี่ยนทั่วอินเตอร์เฟซและแสดงบนใบเสร็จรับเงิน'
                : 'Select a custom color signature matching your brand. Applied live across menus, buttons, and receipt designs.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => setCustomAccentColor(swatch.hex)}
                className="w-8 h-8 rounded-full border border-border border-crisp shadow-sm relative transition-all active:scale-95 cursor-pointer hover:scale-110 flex items-center justify-center shrink-0"
                style={{ backgroundColor: swatch.hex }}
                title={swatch.label}
              >
                {customAccentColor === swatch.hex && (
                  <Check className="h-4 w-4 text-white stroke-[3.5]" />
                )}
              </button>
            ))}

            {/* Custom Color Input */}
            <div className="flex items-center gap-2 border border-border border-crisp rounded-xl p-1.5 bg-background/50 shrink-0">
              <input
                type="color"
                value={customAccentColor || '#3B82F6'}
                onChange={(e) => setCustomAccentColor(e.target.value)}
                className="w-6 h-6 rounded-lg border-0 cursor-pointer overflow-hidden p-0 bg-transparent shrink-0"
              />
              <span className="text-[11px] font-mono tabular-nums font-bold text-text/70 pr-1 select-all uppercase">
                {customAccentColor || 'Default'}
              </span>
            </div>

            {/* Reset Accent */}
            {customAccentColor && (
              <button
                type="button"
                onClick={handleResetAccent}
                className="p-1.5 rounded-lg text-text/60 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer"
                title={language === 'th' ? 'รีเซ็ตเป็นสีธีมมาตรฐาน' : 'Reset to Preset Accent'}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Custom Logo Upload */}
        <div className="p-5 rounded-2xl border border-border border-crisp bg-card shadow-2xs space-y-4">
          <div>
            <h4 className="text-xs font-extrabold text-text uppercase tracking-wider">
              {language === 'th' ? 'โลโก้แบรนด์ร้านค้า (Store Logo Branding)' : 'Store Logo Branding'}
            </h4>
            <p className="text-[11px] text-text/60 mt-1">
              {language === 'th'
                ? 'อัปโหลดภาพโลโก้ของร้านค้า ไฟล์นี้จะจัดเก็บในหน่วยความจำเบราว์เซอร์ และพิมพ์บนใบเสร็จอย่างสวยงาม'
                : 'Upload your store branding logo. Stored in configuration and styled on print templates.'}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Logo Preview */}
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border border-crisp bg-background/50 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              {customLogo ? (
                <img
                  src={customLogo}
                  alt="Custom Store Logo"
                  className="w-full h-full object-contain p-1"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <ImageIcon className="h-6 w-6 text-brand-text-secondary" />
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'อัปโหลดภาพ' : 'Upload Image'}</span>
                </button>

                {customLogo && (
                  <button
                    type="button"
                    onClick={handleResetLogo}
                    className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50/50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 hover:bg-rose-100 transition active:scale-95 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{language === 'th' ? 'ลบภาพ' : 'Remove'}</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <span className="text-[10px] text-brand-text-secondary">
                {language === 'th' ? 'แนะนำสัดส่วน 1:1, รองรับไฟล์ JPG, PNG, SVG (สูงสุด 1MB)' : '1:1 ratio recommended. Supports JPG, PNG, SVG up to 1MB.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
