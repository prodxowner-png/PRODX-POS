import React, { useState } from 'react';
import {
  Palette,
  Check,
  Eye,
  Sparkles,
  ShoppingBag,
  CreditCard,
  Search,
  Plus,
  Trash2,
  Tag,
  Zap,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Coffee,
  CheckSquare,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme, THEME_PRESETS, ThemePreset } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';

export const InteractiveThemePreview: React.FC = () => {
  const { language } = useLanguage();
  const { activePresetId, currentPreset, setPreset } = useTheme();
  const { addToast } = useToast();

  // Local state for the preview preset being inspected (defaults to current active preset)
  const [selectedPreviewId, setSelectedPreviewId] = useState<string>(activePresetId);
  const [previewCategoryTab, setPreviewCategoryTab] = useState<'all' | 'beverage' | 'bakery'>('beverage');

  // Find the currently selected preview theme object
  const previewTheme = THEME_PRESETS.find((p) => p.id === selectedPreviewId) || currentPreset;
  const isCurrentlyActive = activePresetId === previewTheme.id;

  const handleApplyTheme = () => {
    setPreset(previewTheme.id);
    addToast({
      title: language === 'th' ? 'ปรับใช้ธีมสำเร็จ (Theme Applied)' : 'Theme Applied System-Wide',
      message:
        language === 'th'
          ? `เปิดใช้งานธีม "${previewTheme.name[language]}" สำหรับทุกหน้าเรียบร้อยแล้ว`
          : `System aesthetics updated to "${previewTheme.name[language]}"`,
      type: 'success',
    });
  };

  return (
    <Card className="border border-border/80 shadow-md rounded-2xl overflow-hidden bg-card">
      <CardHeader className="bg-card/70 border-b border-border/60 py-4 px-5 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-text">
                  {language === 'th'
                    ? 'ห้องทดลองพรีวิวธีมแบบอินเทอร์แอคทีฟ (Interactive Theme Sandbox)'
                    : 'Interactive Theme Preview Sandbox'}
                </h3>
                <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                  Live Preview
                </Badge>
              </div>
              <p className="text-xs text-text/60 mt-0.5">
                {language === 'th'
                  ? 'เลือกสลับทั้ง 6 ธีมเพื่อดูผลลัพธ์การแสดงผลบนองค์ประกอบ UI จำลองได้ทันทีก่อนการตัดสินใจปรับใช้จริง'
                  : 'Toggle between all six predefined color themes and preview live dummy POS UI elements before applying.'}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleApplyTheme}
            disabled={isCurrentlyActive}
            className={`rounded-xl font-bold text-xs py-2 px-4 shadow-sm transition-all ${
              isCurrentlyActive
                ? 'opacity-60 cursor-not-allowed bg-muted text-text/40 border border-border'
                : 'bg-primary hover:bg-primary-dark text-primary-foreground'
            }`}
            leftIcon={isCurrentlyActive ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          >
            {isCurrentlyActive
              ? language === 'th'
                ? 'ใช้งานอยู่ขณะนี้ (Active)'
                : 'Currently Active'
              : language === 'th'
              ? 'ปรับใช้ธีมนี้ทั้งระบบ (Apply Theme)'
              : 'Apply Selected Theme'}
          </Button>
        </div>
      </CardHeader>

      <CardBody className="p-5 sm:p-6 space-y-6">
        {/* Theme Preset Selector Bar (6 Swatches Tabs) */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-text uppercase tracking-wider flex items-center justify-between">
            <span>
              {language === 'th' ? '1. เลือกธีมที่ต้องการทดลองพรีวิว (Select Theme to Preview):' : '1. Select Theme to Preview:'}
            </span>
            <span className="text-[11px] text-text/50 font-mono font-normal">
              {previewTheme.name[language]}
            </span>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {THEME_PRESETS.map((preset) => {
              const isSelected = selectedPreviewId === preset.id;
              const isActiveInSystem = activePresetId === preset.id;

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreviewId(preset.id)}
                  className={`relative p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 select-none ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/30 bg-card shadow-sm'
                      : 'border-border/80 bg-background/60 hover:bg-card hover:border-border'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1">
                      {preset.swatches.slice(0, 3).map((hex, idx) => (
                        <div
                          key={idx}
                          className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-2xs"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                    {isActiveInSystem && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" title="Active System Theme" />
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-bold text-text truncate">
                      {preset.name[language]}
                    </div>
                    <div className="text-[9px] text-text/50 font-mono truncate">
                      {preset.badge}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Interactive Dummy POS UI Container */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>{language === 'th' ? '2. ตัวอย่างการแสดงผลระบบ POS สด (Live Dummy POS Interface):' : '2. Live Dummy POS Interface Preview:'}</span>
            </span>
            <Badge variant="neutral" size="sm" className="font-mono text-[9px]">
              Theme Radius: {previewTheme.buttonRadius}
            </Badge>
          </div>

          {/* Simulated Screen Frame applying selected theme CSS tokens directly */}
          <div
            className="w-full rounded-2xl border p-4 sm:p-5 shadow-inner transition-all duration-300 space-y-4"
            style={{
              backgroundColor: previewTheme.background,
              borderColor: previewTheme.border,
              color: previewTheme.text,
              fontFamily: 'sans-serif',
            }}
          >
            {/* Dummy Header Bar */}
            <div
              className="p-3 rounded-xl border flex items-center justify-between gap-3 shadow-2xs"
              style={{
                backgroundColor: previewTheme.card,
                borderColor: previewTheme.border,
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-black text-xs shadow-2xs"
                  style={{ backgroundColor: previewTheme.primary }}
                >
                  P
                </div>
                <div>
                  <div className="text-xs font-black tracking-tight" style={{ color: previewTheme.text }}>
                    PRODX POS Store #01
                  </div>
                  <div className="text-[10px]" style={{ color: previewTheme.textMuted }}>
                    Terminal BKK-Central • Online
                  </div>
                </div>
              </div>

              {/* Dummy Search Input */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs w-48" style={{ backgroundColor: previewTheme.background, borderColor: previewTheme.border }}>
                <Search className="h-3.5 w-3.5" style={{ color: previewTheme.textMuted }} />
                <span className="text-[11px]" style={{ color: previewTheme.textMuted }}>
                  {language === 'th' ? 'ค้นหาสินค้า / บาร์โค้ด...' : 'Search items...'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: previewTheme.primaryLight, color: previewTheme.primary }}
                >
                  {previewTheme.badge}
                </span>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: previewTheme.primaryDark }}
                >
                  OP
                </div>
              </div>
            </div>

            {/* Dummy Content Split Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Category Tabs & Product Catalog Grid (7 cols) */}
              <div className="lg:col-span-7 space-y-3">
                {/* Category Filter Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {[
                    { id: 'beverage', label: language === 'th' ? 'เครื่องดื่ม (Beverage)' : 'Beverages' },
                    { id: 'bakery', label: language === 'th' ? 'เบเกอรี่ (Bakery)' : 'Bakery' },
                    { id: 'all', label: language === 'th' ? 'ทั้งหมด (All Items)' : 'All Items' },
                  ].map((tab) => {
                    const isActive = previewCategoryTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPreviewCategoryTab(tab.id as any)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                        style={{
                          backgroundColor: isActive ? previewTheme.primary : previewTheme.card,
                          color: isActive ? '#FFFFFF' : previewTheme.text,
                          border: `1px solid ${isActive ? previewTheme.primary : previewTheme.border}`,
                          borderRadius: previewTheme.buttonRadius,
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Product Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    {
                      name: language === 'th' ? 'อูจิ มัทฉะ ลาเต้' : 'Uji Matcha Latte',
                      category: 'Beverage',
                      price: '฿ 125.00',
                      icon: Coffee,
                      badge: 'HOT',
                    },
                    {
                      name: language === 'th' ? 'ครัวซองต์เนยสดฝรั่งเศส' : 'French Butter Croissant',
                      category: 'Bakery',
                      price: '฿ 85.00',
                      icon: Tag,
                      badge: 'NEW',
                    },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border flex flex-col justify-between gap-3 shadow-2xs transition-all hover:scale-[1.01]"
                      style={{
                        backgroundColor: previewTheme.card,
                        borderColor: previewTheme.border,
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div
                          className="p-2 rounded-lg text-white shadow-2xs"
                          style={{ backgroundColor: previewTheme.primary }}
                        >
                          <item.icon className="h-4 w-4" />
                        </div>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-extrabold"
                          style={{
                            backgroundColor: previewTheme.primaryLight,
                            color: previewTheme.primary,
                          }}
                        >
                          {item.badge}
                        </span>
                      </div>

                      <div>
                        <div className="text-xs font-bold leading-tight" style={{ color: previewTheme.text }}>
                          {item.name}
                        </div>
                        <div className="text-[10px] mt-0.5 font-medium" style={{ color: previewTheme.textMuted }}>
                          {item.category}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: previewTheme.border }}>
                        <span className="text-xs font-black font-mono" style={{ color: previewTheme.primary }}>
                          {item.price}
                        </span>
                        <button
                          type="button"
                          className="p-1 rounded-md text-white shadow-2xs cursor-pointer"
                          style={{ backgroundColor: previewTheme.primary, borderRadius: previewTheme.buttonRadius }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Order Cart Summary Panel (5 cols) */}
              <div
                className="lg:col-span-5 p-3.5 rounded-xl border flex flex-col justify-between gap-3 shadow-2xs"
                style={{
                  backgroundColor: previewTheme.card,
                  borderColor: previewTheme.border,
                }}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: previewTheme.border }}>
                    <div className="flex items-center gap-1.5">
                      <ShoppingBag className="h-4 w-4" style={{ color: previewTheme.primary }} />
                      <span className="text-xs font-bold" style={{ color: previewTheme.text }}>
                        {language === 'th' ? 'รายการคำสั่งซื้อ #ORD-882' : 'Order Cart #ORD-882'}
                      </span>
                    </div>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
                      style={{ backgroundColor: previewTheme.primaryLight, color: previewTheme.primary }}
                    >
                      2 Items
                    </span>
                  </div>

                  {/* Cart Items List */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold" style={{ color: previewTheme.text }}>
                          1x Uji Matcha Latte
                        </div>
                        <div className="text-[10px]" style={{ color: previewTheme.textMuted }}>
                          Oat Milk +฿15, Sweet 50%
                        </div>
                      </div>
                      <span className="font-bold font-mono" style={{ color: previewTheme.text }}>
                        ฿140
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold" style={{ color: previewTheme.text }}>
                          1x French Butter Croissant
                        </div>
                        <div className="text-[10px]" style={{ color: previewTheme.textMuted }}>
                          Warmed Up
                        </div>
                      </div>
                      <span className="font-bold font-mono" style={{ color: previewTheme.text }}>
                        ฿85
                      </span>
                    </div>
                  </div>
                </div>

                {/* Receipt Calculations & Action Buttons */}
                <div className="space-y-2.5 pt-2 border-t" style={{ borderColor: previewTheme.border }}>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between" style={{ color: previewTheme.textMuted }}>
                      <span>Subtotal</span>
                      <span className="font-mono">฿225.00</span>
                    </div>
                    <div className="flex justify-between" style={{ color: previewTheme.textMuted }}>
                      <span>VAT (7%)</span>
                      <span className="font-mono">฿15.75</span>
                    </div>
                    <div className="flex justify-between text-xs font-black pt-1 border-t" style={{ borderColor: previewTheme.border, color: previewTheme.text }}>
                      <span>{language === 'th' ? 'ยอดรวมทั้งสิ้น' : 'Total Payable'}</span>
                      <span className="font-mono text-sm" style={{ color: previewTheme.primary }}>
                        ฿240.75
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      className="py-2 px-3 text-xs font-bold text-white flex items-center justify-center gap-1 shadow-2xs cursor-pointer"
                      style={{
                        backgroundColor: previewTheme.primary,
                        borderRadius: previewTheme.buttonRadius,
                      }}
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      <span>{language === 'th' ? 'ชำระเงิน' : 'Checkout'}</span>
                    </button>

                    <button
                      type="button"
                      className="py-2 px-3 text-xs font-bold border flex items-center justify-center gap-1 cursor-pointer"
                      style={{
                        backgroundColor: previewTheme.background,
                        borderColor: previewTheme.border,
                        color: previewTheme.text,
                        borderRadius: previewTheme.buttonRadius,
                      }}
                    >
                      <span>{language === 'th' ? 'ส่วนลด' : 'Discount'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
