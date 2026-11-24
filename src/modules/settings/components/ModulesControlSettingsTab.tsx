import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Sliders,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronUp,
  Shield,
  Layers,
  Zap,
  ShoppingCart,
  Boxes,
  ReceiptText,
  Banknote,
  Users,
  LayoutGrid,
  ShieldCheck,
  Tv,
} from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { GraphicIcon } from '../../../components/common/GraphicIcon';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { SystemModuleConfig, SystemModuleFeature } from '../types';

export interface ModulesControlSettingsTabProps {
  modules: SystemModuleConfig[];
  onUpdateModules: (modules: SystemModuleConfig[]) => void;
  onResetModules: () => void;
}

export const ModulesControlSettingsTab: React.FC<ModulesControlSettingsTabProps> = ({
  modules,
  onUpdateModules,
  onResetModules,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'enabled' | 'disabled'>('all');

  const getModuleIcon = (iconName: string) => {
    switch (iconName) {
      case 'ShoppingCart':
        return ShoppingCart;
      case 'Boxes':
        return Boxes;
      case 'ReceiptText':
        return ReceiptText;
      case 'Banknote':
        return Banknote;
      case 'Users':
        return Users;
      case 'LayoutGrid':
        return LayoutGrid;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'Tv':
        return Tv;
      default:
        return Layers;
    }
  };

  const handleToggleModule = (moduleId: string) => {
    const updated = modules.map((mod) => {
      if (mod.id === moduleId) {
        const nextState = !mod.enabled;
        return { ...mod, enabled: nextState };
      }
      return mod;
    });
    onUpdateModules(updated);

    const target = modules.find((m) => m.id === moduleId);
    if (target) {
      addToast({
        title: language === 'th' ? 'อัปเดตสถานะโมดูล' : 'Module Status Changed',
        message:
          language === 'th'
            ? `${target.name.th} ถูก ${!target.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`
            : `${target.name.en} is now ${!target.enabled ? 'enabled' : 'disabled'}.`,
        type: 'info',
      });
    }
  };

  const handleToggleFeature = (moduleId: string, featureId: string) => {
    const updated = modules.map((mod) => {
      if (mod.id === moduleId) {
        const nextFeatures = mod.features.map((feat) => {
          if (feat.id === featureId) {
            return { ...feat, enabled: !feat.enabled };
          }
          return feat;
        });
        return { ...mod, features: nextFeatures };
      }
      return mod;
    });
    onUpdateModules(updated);
  };

  const handleEnableAll = () => {
    const updated = modules.map((m) => ({
      ...m,
      enabled: true,
      features: m.features.map((f) => ({ ...f, enabled: true })),
    }));
    onUpdateModules(updated);
    addToast({
      title: language === 'th' ? 'เปิดใช้งานทุกโมดูล' : 'All Modules Enabled',
      message:
        language === 'th'
          ? 'เปิดใช้งานโมดูลและฟีเจอร์ย่อยทั้งหมดในระบบเรียบร้อยแล้ว'
          : 'All system modules and sub-features are now fully active.',
      type: 'success',
    });
  };

  // Filter modules
  const filteredModules = modules.filter((mod) => {
    const matchSearch =
      mod.name.th.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.name.en.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.description.th.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.description.en.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.features.some(
        (f) =>
          f.name.th.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.name.en.toLowerCase().includes(searchQuery.toLowerCase())
      );

    if (!matchSearch) return false;
    if (filterMode === 'enabled') return mod.enabled;
    if (filterMode === 'disabled') return !mod.enabled;
    return true;
  });

  const totalModules = modules.length;
  const activeModulesCount = modules.filter((m) => m.enabled).length;
  const totalFeatures = modules.reduce((acc, m) => acc + m.features.length, 0);
  const activeFeaturesCount = modules.reduce(
    (acc, m) => acc + m.features.filter((f) => f.enabled).length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Metric Summary */}
      <div className="bg-card rounded-2xl border border-border border-crisp p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <GraphicIcon
              icon={Sliders}
              color="primary"
              variant="glow"
              size="lg"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-text tracking-tight">
                  {language === 'th'
                    ? 'ศูนย์ควบคุมและจัดการโมดูลทั้งระบบ (100% System Module Manager)'
                    : 'Unified Module & Feature Control Center'}
                </h2>
                <Badge variant="primary" size="sm">
                  100% Controlled
                </Badge>
              </div>
              <p className="text-xs text-text/60 mt-1">
                {language === 'th'
                  ? 'เปิด/ปิด และกำหนดค่าการทำงานของทุกโมดูลและคอมโพเนนต์ย่อยทั่วทั้งแอปพลิเคชัน'
                  : 'Centralized control to enable, disable, and tune every module and sub-feature.'}
              </p>
            </div>
          </div>

          {/* Quick Action Tools */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleEnableAll}
              leftIcon={<Zap className="h-4 w-4 text-amber-500" />}
            >
              {language === 'th' ? 'เปิดทั้งหมด' : 'Enable All'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onResetModules}
              leftIcon={<RotateCcw className="h-4 w-4 text-text/60" />}
            >
              {language === 'th' ? 'รีเซ็ตค่าเริ่มต้น' : 'Reset Defaults'}
            </Button>
          </div>
        </div>

        {/* System Health & Active Counts Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-border/60">
          <div className="p-3 rounded-xl bg-background border border-border/70">
            <div className="text-[11px] font-semibold text-text/60">
              {language === 'th' ? 'โมดูลที่ทำงาน' : 'Active Modules'}
            </div>
            <div className="text-lg font-black text-text mt-0.5 flex items-center gap-2">
              <span>
                {activeModulesCount} / {totalModules}
              </span>
              <span className="text-xs font-bold text-emerald-500">
                ({Math.round((activeModulesCount / totalModules) * 100)}%)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-background border border-border/70">
            <div className="text-[11px] font-semibold text-text/60">
              {language === 'th' ? 'ฟีเจอร์ย่อยที่เปิดใช้' : 'Active Sub-Features'}
            </div>
            <div className="text-lg font-black text-text mt-0.5 flex items-center gap-2">
              <span>
                {activeFeaturesCount} / {totalFeatures}
              </span>
              <span className="text-xs font-bold text-primary">
                ({Math.round((activeFeaturesCount / totalFeatures) * 100)}%)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-background border border-border/70">
            <div className="text-[11px] font-semibold text-text/60">
              {language === 'th' ? 'สถานะความสมบูรณ์' : 'System Integrity'}
            </div>
            <div className="text-lg font-black text-emerald-500 mt-0.5 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              <span>100% Operational</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-background border border-border/70">
            <div className="text-[11px] font-semibold text-text/60">
              {language === 'th' ? 'ความปลอดภัย (RBAC)' : 'Security Enforced'}
            </div>
            <div className="text-lg font-black text-brand-text-accent mt-0.5 flex items-center gap-1.5">
              <Shield className="h-4 w-4" />
              <span>Protected</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-text-secondary pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              language === 'th'
                ? 'ค้นหาโมดูล หรือฟีเจอร์ย่อย...'
                : 'Search modules or features...'
            }
            className="w-full min-h-[44px] h-11 pl-9 pr-4 text-base sm:text-sm font-bold rounded-xl border border-border bg-card text-text placeholder:text-brand-text-secondary focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta"
          />
        </div>

        {/* Filter Segmented Controls */}
        <div role="tablist" aria-label={language === 'th' ? 'ตัวกรองโมดูล' : 'Module filters'} className="inline-flex p-1 bg-card rounded-xl border border-border self-stretch sm:self-auto">
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
              filterMode === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-brand-text-secondary hover:text-text'
            }`}
          >
            {language === 'th' ? 'ทั้งหมด' : 'All'} ({modules.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'enabled'}
            onClick={() => setFilterMode('enabled')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
              filterMode === 'enabled'
                ? 'bg-emerald-500 text-white shadow-xs'
                : 'text-brand-text-secondary hover:text-text'
            }`}
          >
            {language === 'th' ? 'เปิดใช้งาน' : 'Enabled'} ({activeModulesCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'disabled'}
            onClick={() => setFilterMode('disabled')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
              filterMode === 'disabled'
                ? 'bg-rose-500 text-white shadow-xs'
                : 'text-brand-text-secondary hover:text-text'
            }`}
          >
            {language === 'th' ? 'ปิดใช้งาน' : 'Disabled'} ({totalModules - activeModulesCount})
          </button>
        </div>
      </div>

      {/* Modules List Grid */}
      <div className="space-y-4">
        {filteredModules.map((module) => {
          const isExpanded = expandedModuleId === module.id;
          const activeSubCount = module.features.filter((f) => f.enabled).length;

          return (
            <div
              key={module.id}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden bg-card ${
                module.enabled
                  ? 'border-border/90 shadow-xs'
                  : 'border-border/40 opacity-75 bg-card/60'
              }`}
            >
              {/* Module Main Header Row */}
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <GraphicIcon
                    icon={getModuleIcon(module.iconName)}
                    color={module.color}
                    variant={module.enabled ? 'badge' : 'flat'}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-black text-text tracking-tight">
                        {module.name[language]}
                      </h3>
                      {module.badge && (
                        <Badge
                          variant={module.enabled ? 'primary' : 'neutral'}
                          size="sm"
                          className="text-[10px]"
                        >
                          {module.badge}
                        </Badge>
                      )}
                      <span className="text-[10px] font-mono text-text/40 uppercase">
                        {module.code}
                      </span>
                    </div>
                    <p className="text-xs text-text/60 mt-0.5 line-clamp-1">
                      {module.description[language]}
                    </p>
                  </div>
                </div>

                {/* Right Side: Toggle Switch & Expand Button */}
                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <div className="text-right hidden md:block">
                    <div className="text-[11px] font-bold text-text">
                      {activeSubCount} / {module.features.length}{' '}
                      {language === 'th' ? 'ฟีเจอร์' : 'Features'}
                    </div>
                    <div className="text-[10px] text-text/50">
                      {module.enabled
                        ? language === 'th'
                          ? 'พร้อมทำงาน'
                          : 'Operational'
                        : language === 'th'
                        ? 'ปิดชั่วคราว'
                        : 'Inactive'}
                    </div>
                  </div>

                  {/* Primary Enable Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={module.enabled}
                      onChange={() => handleToggleModule(module.id)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-border/80 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary shadow-2xs"></div>
                  </label>

                  {/* Sub-features Accordion Toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedModuleId(isExpanded ? null : module.id)
                    }
                    className="p-2 rounded-xl hover:bg-background text-text/60 hover:text-text transition-colors cursor-pointer"
                    title={
                      isExpanded
                        ? language === 'th'
                          ? 'ซ่อนฟีเจอร์ย่อย'
                          : 'Collapse'
                        : language === 'th'
                        ? 'ดูฟีเจอร์ย่อย'
                        : 'Expand sub-features'
                    }
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Sub-Features Accordion Content */}
              {isExpanded && (
                <div className="px-4 sm:px-5 pb-5 pt-2 border-t border-border/50 bg-background/50 space-y-3">
                  <div className="text-[11px] font-bold text-text/60 uppercase tracking-wider flex items-center justify-between">
                    <span>
                      {language === 'th'
                        ? 'การกำหนดค่าและฟีเจอร์ย่อยในโมดูลนี้'
                        : 'Module Sub-Features & Component Flags'}
                    </span>
                    <span className="text-[10px] font-mono text-text/40">
                      {activeSubCount} Active
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {module.features.map((feature) => (
                      <div
                        key={feature.id}
                        className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                          feature.enabled && module.enabled
                            ? 'bg-card border-border/80 shadow-2xs'
                            : 'bg-card/40 border-border/40 opacity-70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-text flex items-center gap-1.5">
                            <span>{feature.name[language]}</span>
                            {feature.enabled && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            )}
                          </div>
                          <p className="text-[11px] text-text/50 mt-0.5 leading-snug">
                            {feature.description[language]}
                          </p>
                        </div>

                        {/* Feature Toggle */}
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            disabled={!module.enabled}
                            checked={feature.enabled && module.enabled}
                            onChange={() =>
                              handleToggleFeature(module.id, feature.id)
                            }
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-border/80 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-disabled:opacity-40"></div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
