import React, { useState } from 'react';
import {
  Crown,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Gift,
  Coins,
  Calculator,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Percent,
} from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { GraphicIcon, GraphicIconColor } from '../../../components/common/GraphicIcon';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { Modal } from '../../../components/common/Modal';
import { LoyaltyEngineConfig, LoyaltyTierItem } from '../types';

export interface LoyaltyCrmSettingsTabProps {
  loyaltyConfig: LoyaltyEngineConfig;
  onChangeConfig: (config: LoyaltyEngineConfig) => void;
}

export const LoyaltyCrmSettingsTab: React.FC<LoyaltyCrmSettingsTabProps> = ({
  loyaltyConfig,
  onChangeConfig,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();

  // Modal State for Adding/Editing VIP Tiers
  const [isTierModalOpen, setIsTierModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTierItem | null>(null);
  const [tierForm, setTierForm] = useState<Partial<LoyaltyTierItem>>({
    name: '',
    minSpend: 0,
    pointMultiplier: 1.0,
    discountPercent: 0,
    color: 'amber',
    badge: 'VIP',
    perks: [''],
  });

  // Live Simulator States
  const [simSpend, setSimSpend] = useState<number>(1000);
  const [simTierId, setSimTierId] = useState<string>('tier-gold');

  const handleOpenTierModal = (tier?: LoyaltyTierItem) => {
    if (tier) {
      setEditingTier(tier);
      setTierForm({ ...tier, perks: [...tier.perks] });
    } else {
      setEditingTier(null);
      setTierForm({
        id: `tier-${Date.now()}`,
        name: '',
        minSpend: 10000,
        pointMultiplier: 1.2,
        discountPercent: 5,
        color: 'cyan',
        badge: 'VIP',
        perks: ['ส่วนลดพิเศษประจำระดับ', 'สะสมแต้มคูณสอง'],
      });
    }
    setIsTierModalOpen(true);
  };

  const handleSaveTier = () => {
    if (!tierForm.name?.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุชื่อระดับสมาชิก' : 'Tier Name Required',
        message: language === 'th' ? 'ต้องระบุชื่อระดับ VIP' : 'Please provide a tier name',
        type: 'error',
      });
      return;
    }

    const cleanPerks = (tierForm.perks || []).filter((p) => p.trim() !== '');

    if (editingTier) {
      const updatedTiers = loyaltyConfig.tiers.map((t) =>
        t.id === editingTier.id
          ? ({ ...t, ...tierForm, perks: cleanPerks } as LoyaltyTierItem)
          : t
      );
      onChangeConfig({ ...loyaltyConfig, tiers: updatedTiers });
    } else {
      const newTier: LoyaltyTierItem = {
        id: `tier-${Date.now()}`,
        name: tierForm.name || 'VIP Member',
        minSpend: Number(tierForm.minSpend) || 0,
        pointMultiplier: Number(tierForm.pointMultiplier) || 1.0,
        discountPercent: Number(tierForm.discountPercent) || 0,
        color: tierForm.color || 'primary',
        badge: (tierForm.badge || 'VIP').toUpperCase(),
        perks: cleanPerks.length > 0 ? cleanPerks : ['สิทธิประโยชน์พิเศษ'],
      };
      onChangeConfig({
        ...loyaltyConfig,
        tiers: [...loyaltyConfig.tiers, newTier],
      });
    }

    setIsTierModalOpen(false);
    addToast({
      title: language === 'th' ? 'บันทึกระดับสมาชิกสำเร็จ' : 'VIP Tier Saved',
      message: language === 'th' ? 'อัปเดตสิทธิประโยชน์ระดับสมาชิกเรียบร้อย' : 'Updated VIP tier criteria.',
      type: 'success',
    });
  };

  const handleDeleteTier = (id: string) => {
    if (loyaltyConfig.tiers.length <= 1) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบได้' : 'Cannot Delete',
        message: language === 'th' ? 'ต้องมีระดับสมาชิกอย่างน้อย 1 ระดับ' : 'At least one tier is required.',
        type: 'error',
      });
      return;
    }
    onChangeConfig({
      ...loyaltyConfig,
      tiers: loyaltyConfig.tiers.filter((t) => t.id !== id),
    });
    addToast({
      title: language === 'th' ? 'ลบระดับสมาชิกแล้ว' : 'VIP Tier Removed',
      message: language === 'th' ? 'นำระดับสมาชิกออกจากระบบเรียบร้อย' : 'Deleted tier.',
      type: 'info',
    });
  };

  // Compute Live Simulation
  const selectedTier =
    loyaltyConfig.tiers.find((t) => t.id === simTierId) || loyaltyConfig.tiers[0];
  const discountAmount = selectedTier
    ? (simSpend * selectedTier.discountPercent) / 100
    : 0;
  const netSpend = Math.max(0, simSpend - discountAmount);
  const basePoints =
    loyaltyConfig.pointsEarnRate > 0
      ? Math.floor(netSpend / loyaltyConfig.pointsEarnRate)
      : 0;
  const finalPoints = Math.floor(basePoints * (selectedTier?.pointMultiplier || 1));

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-card rounded-2xl border border-border border-crisp p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <GraphicIcon
              icon={Crown}
              color="purple"
              variant="glow"
              size="lg"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-text tracking-tight">
                  {language === 'th'
                    ? 'ระบบสมาชิก แต้มสะสม และระดับ VIP (Loyalty & VIP Tiers)'
                    : 'Customer Loyalty, Points & VIP Tiers'}
                </h2>
                <Badge variant="primary" size="sm">
                  CRM Engine
                </Badge>
              </div>
              <p className="text-xs text-text/60 mt-0.5">
                {language === 'th'
                  ? 'กำหนดอัตราการสะสมแต้ม แลกส่วนลด และระดับขั้นสมาชิก Bronze, Silver, Gold, Platinum'
                  : 'Configure points accrual engine, redemption rates, and tiered VIP privileges.'}
              </p>
            </div>
          </div>

          {/* Engine Master Toggle */}
          <label className="relative inline-flex items-center cursor-pointer shrink-0 self-end sm:self-center">
            <input
              type="checkbox"
              checked={loyaltyConfig.enabled}
              onChange={(e) =>
                onChangeConfig({ ...loyaltyConfig, enabled: e.target.checked })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-border/80 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500 shadow-2xs"></div>
          </label>
        </div>
      </div>

      {/* Points Accrual & Redemption Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-text">
            <Coins className="h-4 w-4 text-amber-500" />
            <span>
              {language === 'th'
                ? 'อัตราการได้รับแต้ม (Earn Rate)'
                : 'Points Earn Rate'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal"
              min={1}
              value={loyaltyConfig.pointsEarnRate}
              onChange={(e) =>
                onChangeConfig({
                  ...loyaltyConfig,
                  pointsEarnRate: Math.max(1, Number(e.target.value)),
                })
              }
              className="w-24 px-3 py-1.5 text-xs font-black rounded-xl border border-border bg-background text-text text-center focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs font-bold text-text/70">
              {language === 'th' ? 'บาท = 1 แต้ม' : 'THB = 1 Point'}
            </span>
          </div>
          <p className="text-[11px] text-brand-text-secondary">
            {language === 'th'
              ? 'ซื้อสินค้าครบทุกๆ จำนวนบาทนี้ จะได้รับ 1 แต้มสะสม'
              : 'Amount spent required to grant one loyalty point.'}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-text">
            <Gift className="h-4 w-4 text-emerald-500" />
            <span>
              {language === 'th'
                ? 'อัตราการแลกแต้ม (Redeem Rate)'
                : 'Points Redeem Rate'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal"
              min={1}
              value={loyaltyConfig.pointsRedeemRate}
              onChange={(e) =>
                onChangeConfig({
                  ...loyaltyConfig,
                  pointsRedeemRate: Math.max(1, Number(e.target.value)),
                })
              }
              className="w-24 px-3 py-1.5 text-xs font-black rounded-xl border border-border bg-background text-text text-center focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs font-bold text-text/70">
              {language === 'th' ? 'แต้ม = ส่วนลด 1 บาท' : 'Points = 1 THB Discount'}
            </span>
          </div>
          <p className="text-[11px] text-brand-text-secondary">
            {language === 'th'
              ? 'จำนวนแต้มที่ลูกค้าต้องใช้แลกเป็นส่วนลดเงินสด 1 บาท'
              : 'Points cost per one THB checkout bill discount.'}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-text">
            <TrendingUp className="h-4 w-4 text-brand-text-accent" />
            <span>
              {language === 'th'
                ? 'อายุของแต้มสะสม (Expiry)'
                : 'Points Validity'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal"
              min={30}
              value={loyaltyConfig.pointsExpiryDays}
              onChange={(e) =>
                onChangeConfig({
                  ...loyaltyConfig,
                  pointsExpiryDays: Math.max(1, Number(e.target.value)),
                })
              }
              className="w-24 px-3 py-1.5 text-xs font-black rounded-xl border border-border bg-background text-text text-center focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs font-bold text-text/70">
              {language === 'th' ? 'วัน (Days)' : 'Days'}
            </span>
          </div>
          <p className="text-[11px] text-brand-text-secondary">
            {language === 'th'
              ? 'ระยะเวลาที่แต้มมีอายุใช้งานก่อนตัดสิทธิ์อัตโนมัติ'
              : 'Number of calendar days before accrued points expire.'}
          </p>
        </div>
      </div>

      {/* VIP Membership Tiers Management */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-text">
              {language === 'th'
                ? 'ลำดับขั้นสมาชิกระดับ VIP (VIP Tier Profiles)'
                : 'VIP Tier Profiles'}
            </h3>
            <p className="text-xs text-text/60">
              {language === 'th'
                ? 'ปรับแต่งสิทธิประโยชน์ ตัวคูณแต้ม และเปอร์เซ็นต์ส่วนลดอัตโนมัติ'
                : 'Configure minimum spending milestones, point multipliers, and tier privileges.'}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleOpenTierModal()}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {language === 'th' ? 'เพิ่มระดับ VIP' : 'Add VIP Tier'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loyaltyConfig.tiers.map((tier) => (
            <div
              key={tier.id}
              className="p-5 rounded-2xl border border-border bg-card shadow-xs flex flex-col justify-between gap-4 transition-all hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <GraphicIcon
                    icon={Crown}
                    color={tier.color}
                    variant="badge"
                    size="md"
                    badgeText={tier.badge}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenTierModal(tier)}
                      className="p-1 rounded-lg hover:bg-background text-text/60 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTier(tier.id)}
                      className="p-1 rounded-lg hover:bg-rose-500/10 text-text/60 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <h4 className="text-sm font-black text-text">{tier.name}</h4>
                  <div className="text-[11px] text-text/60 mt-0.5">
                    {tier.minSpend > 0 ? (
                      <span>
                        ยอดสะสม ฿{tier.minSpend.toLocaleString()} ขึ้นไป
                      </span>
                    ) : (
                      <span>ระดับเริ่มต้น (ไม่มีขั้นต่ำ)</span>
                    )}
                  </div>
                </div>

                {/* Key Benefits Badges */}
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/60">
                  <div className="p-2 rounded-xl bg-background border border-border/70 text-center">
                    <div className="text-[10px] text-brand-text-secondary font-semibold">
                      ตัวคูณแต้ม
                    </div>
                    <div className="text-xs font-black text-brand-text-accent dark:text-brand-text-accent">
                      x{tier.pointMultiplier.toFixed(1)} เท่า
                    </div>
                  </div>
                  <div className="p-2 rounded-xl bg-background border border-border/70 text-center">
                    <div className="text-[10px] text-brand-text-secondary font-semibold">
                      ส่วนลดบิล
                    </div>
                    <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                      {tier.discountPercent > 0
                        ? `${tier.discountPercent}%`
                        : 'ไม่มี'}
                    </div>
                  </div>
                </div>

                {/* Perks list */}
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider">
                    สิทธิพิเศษ
                  </div>
                  <ul className="space-y-1 text-[11px] text-text/70">
                    {tier.perks.map((p, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                        <span className="line-clamp-1">{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Loyalty Simulator */}
      <div className="p-5 rounded-2xl bg-card border border-border border-crisp shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <GraphicIcon
            icon={Calculator}
            color="primary"
            variant="badge"
            size="sm"
          />
          <h3 className="text-sm font-black text-text">
            {language === 'th'
              ? 'เครื่องมือจำลองคำนวณแต้มและส่วนลด (Live Loyalty Simulator)'
              : 'Interactive Loyalty Simulator'}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-text mb-1">
              {language === 'th' ? 'ยอดซื้อตัวอย่าง (บาท)' : 'Sample Spend (THB)'}
            </label>
            <input
              type="number" inputMode="decimal"
              value={simSpend}
              onChange={(e) => setSimSpend(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text mb-1">
              {language === 'th' ? 'เลือกระดับ VIP' : 'Select VIP Tier'}
            </label>
            <select
              value={simTierId}
              onChange={(e) => setSimTierId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text"
            >
              {loyaltyConfig.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (ลด {t.discountPercent}% / แต้ม x{t.pointMultiplier})
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-around">
            <div className="text-center">
              <span className="text-[10px] text-brand-text-secondary font-bold block">
                ส่วนลดที่ได้
              </span>
              <span className="text-xs font-black text-rose-500">
                -฿{discountAmount.toFixed(2)}
              </span>
            </div>
            <div className="h-6 w-[1px] bg-border" />
            <div className="text-center">
              <span className="text-[10px] text-brand-text-secondary font-bold block">
                ยอดสุทธิ
              </span>
              <span className="text-xs font-black text-text">
                ฿{netSpend.toFixed(2)}
              </span>
            </div>
            <div className="h-6 w-[1px] bg-border" />
            <div className="text-center">
              <span className="text-[10px] text-brand-text-secondary font-bold block">
                แต้มที่ได้รับ
              </span>
              <span className="text-xs font-black text-brand-text-accent">
                +{finalPoints} แต้ม
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: ADD/EDIT VIP TIER */}
      <Modal
        isOpen={isTierModalOpen}
        onClose={() => setIsTierModalOpen(false)}
        title={
          editingTier
            ? language === 'th'
              ? 'แก้ไขระดับสมาชิก VIP'
              : 'Edit VIP Tier'
            : language === 'th'
            ? 'เพิ่มระดับสมาชิก VIP ใหม่'
            : 'Add VIP Tier'
        }
      >
        <div className="space-y-4">
          <Input
            label={language === 'th' ? 'ชื่อระดับสมาชิก' : 'Tier Name'}
            value={tierForm.name}
            onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
            placeholder="เช่น Gold Elite"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ยอดสะสมขั้นต่ำ (บาท)"
              type="number"
              value={tierForm.minSpend || ''}
              onChange={(e) =>
                setTierForm({
                  ...tierForm,
                  minSpend: Number(e.target.value),
                })
              }
              placeholder="0"
            />
            <Input
              label="ป้ายสัญลักษณ์ย่อ (Badge)"
              value={tierForm.badge}
              onChange={(e) =>
                setTierForm({ ...tierForm, badge: e.target.value })
              }
              placeholder="GOLD"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ตัวคูณแต้มสะสม (เท่า)"
              type="number"
              step="0.1"
              value={tierForm.pointMultiplier || ''}
              onChange={(e) =>
                setTierForm({
                  ...tierForm,
                  pointMultiplier: Number(e.target.value),
                })
              }
              placeholder="1.5"
            />
            <Input
              label="ส่วนลดบิลอัตโนมัติ (%)"
              type="number"
              value={tierForm.discountPercent || ''}
              onChange={(e) =>
                setTierForm({
                  ...tierForm,
                  discountPercent: Number(e.target.value),
                })
              }
              placeholder="5"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text mb-1.5">
              {language === 'th' ? 'โทนสีกราฟฟิกไอคอน' : 'Graphic Color'}
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  'purple',
                  'amber',
                  'cyan',
                  'emerald',
                  'rose',
                  'indigo',
                  'primary',
                  'slate',
                ] as GraphicIconColor[]
              ).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setTierForm({ ...tierForm, color: col })}
                  className={`p-1.5 rounded-xl border cursor-pointer transition-all ${
                    tierForm.color === col
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border'
                  }`}
                >
                  <GraphicIcon
                    icon={Crown}
                    color={col}
                    variant="badge"
                    size="sm"
                    animateHover={false}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsTierModalOpen(false)}
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveTier}>
              {language === 'th' ? 'บันทึกระดับ VIP' : 'Save VIP Tier'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
