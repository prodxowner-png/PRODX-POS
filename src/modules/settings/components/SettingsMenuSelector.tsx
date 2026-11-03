import React, { useState, useRef, useEffect } from 'react';
import {
  Building2,
  Palette,
  Printer,
  ReceiptText,
  ShieldCheck,
  Database,
  ChevronDown,
  Settings as SettingsIcon,
  Sparkles,
  UserCheck,
  Wrench,
  Crown,
  Search,
  Check,
  X,
  Sliders,
  Layers,
  LayoutGrid,
  Filter,
  ArrowRight,
  Zap,
  KeyRound,
} from 'lucide-react';
import { SettingsTabId, SettingsTabItem } from '../types';
import { Badge } from '../../../components/common/Badge';
import { GraphicIcon, GraphicIconColor } from '../../../components/common/GraphicIcon';

export interface SettingsCategoryGroup {
  id: 'store_pos' | 'hardware_peripherals' | 'loyalty_crm' | 'security_admin';
  label: { th: string; en: string };
  iconName: string;
}

interface SettingsMenuSelectorProps {
  activeTab: SettingsTabId;
  setActiveTab: (tabId: SettingsTabId) => void;
  tabItems: SettingsTabItem[];
  categories: SettingsCategoryGroup[];
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;
  navSearchQuery: string;
  setNavSearchQuery: (query: string) => void;
  settingsMode: 'quick' | 'advanced';
  isStoreDirty: boolean;
  isCfdDirty: boolean;
  isTaxDirty: boolean;
  isSecurityDirty: boolean;
  language: string;
}

export const SettingsMenuSelector: React.FC<SettingsMenuSelectorProps> = ({
  activeTab,
  setActiveTab,
  tabItems,
  categories,
  categoryFilter,
  setCategoryFilter,
  navSearchQuery,
  setNavSearchQuery,
  settingsMode,
  isStoreDirty,
  isCfdDirty,
  isTaxDirty,
  isSecurityDirty,
  language,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Helper icon mapper
  const getLucideIcon = (name: string) => {
    switch (name) {
      case 'Building2':
        return Building2;
      case 'Sparkles':
        return Sparkles;
      case 'Sliders':
        return Sliders;
      case 'Wrench':
        return Wrench;
      case 'Crown':
        return Crown;
      case 'Palette':
        return Palette;
      case 'Printer':
        return Printer;
      case 'ReceiptText':
        return ReceiptText;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'KeyRound':
        return KeyRound;
      case 'UserCheck':
        return UserCheck;
      case 'Layers':
        return Layers;
      case 'Database':
        return Database;
      default:
        return SettingsIcon;
    }
  };

  const currentTabObj = tabItems.find((t) => t.id === activeTab) || tabItems[0];
  const currentCatObj = categories.find((c) => c.id === currentTabObj?.category);
  const ActiveIcon = currentTabObj ? getLucideIcon(currentTabObj.iconName) : SettingsIcon;
  const CatIcon = currentCatObj ? getLucideIcon(currentCatObj.iconName) : Building2;

  const totalModuleCount = tabItems.length;

  return (
    <div className="w-full space-y-3 relative" ref={popoverRef}>
      {/* Top Segmented Category Pill Bar (Works on all screen sizes for fast filtering) */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-1">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
              categoryFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/30'
                : 'bg-card border border-border/80 text-text/70 hover:text-text hover:border-border hover:bg-background/80'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{language === 'th' ? `ทุกหมวดหมู่ (${totalModuleCount})` : `All Categories (${totalModuleCount})`}</span>
          </button>

          {categories.map((cat) => {
            const count = tabItems.filter((t) => t.category === cat.id).length;
            const isCatActive = categoryFilter === cat.id;
            const CatHeaderIcon = getLucideIcon(cat.iconName);

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                  isCatActive
                    ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/30'
                    : 'bg-card border border-border/80 text-text/70 hover:text-text hover:border-border hover:bg-background/80'
                }`}
              >
                <CatHeaderIcon className="w-3.5 h-3.5" />
                <span>
                  {cat.label[language === 'th' ? 'th' : 'en']} ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* View mode toggle (List vs Grid in menu) */}
        <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-card border border-border/80 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List View"
            className={`p-1.5 rounded-lg transition ${
              viewMode === 'list' ? 'bg-primary text-white font-bold' : 'text-text/50 hover:text-text'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Grid View"
            className={`p-1.5 rounded-lg transition ${
              viewMode === 'grid' ? 'bg-primary text-white font-bold' : 'text-text/50 hover:text-text'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Interactive Menu Selector Card (Replaces basic dropdown) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full p-3.5 rounded-2xl border transition-all cursor-pointer select-none flex items-center justify-between gap-3 shadow-sm active:scale-[0.995] ${
            isOpen
              ? 'border-primary ring-2 ring-primary/20 bg-primary/5 text-primary'
              : 'border-border/80 bg-card hover:border-primary/40 text-text'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <GraphicIcon
              icon={ActiveIcon}
              color={currentTabObj?.graphicColor || 'primary'}
              variant="badge"
              size="md"
            />
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-primary flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                  <CatIcon className="w-3 h-3" />
                  <span>{currentCatObj ? currentCatObj.label[language === 'th' ? 'th' : 'en'] : ''}</span>
                </span>
                {currentTabObj?.badge && (
                  <Badge variant="neutral" size="sm" className="font-mono text-[9px]">
                    {currentTabObj.badge}
                  </Badge>
                )}
              </div>
              <div className="text-sm font-black text-text truncate mt-1">
                {currentTabObj ? currentTabObj.label[language === 'th' ? 'th' : 'en'] : ''}
              </div>
              <p className="text-xs text-text/60 truncate hidden sm:block mt-0.5">
                {currentTabObj ? currentTabObj.sublabel[language === 'th' ? 'th' : 'en'] : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline text-xs font-bold px-2.5 py-1 rounded-lg bg-background border border-border text-text/70">
              {language === 'th' ? 'คลิกสลับเมนู' : 'Switch Menu'}
            </span>
            <div className={`p-2 rounded-xl bg-primary/10 text-primary transition-transform duration-200 ${isOpen ? 'rotate-180 bg-primary text-white' : ''}`}>
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
        </button>

        {/* Expanded Popover Menu Modal Sheet */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-card rounded-2xl border border-border/90 shadow-2xl p-4 sm:p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[80vh] overflow-y-auto">
            {/* Header & Filter Search input inside Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/70">
              <div>
                <div className="text-xs font-black text-text uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>
                    {language === 'th' ? 'เลือกเมนูการตั้งค่าระบบ (Settings Navigation Hub)' : 'Settings Navigation Hub'}
                  </span>
                </div>
                <p className="text-[11px] text-text/60 mt-0.5">
                  {language === 'th' ? 'ค้นหา และเลือกหัวข้อตั้งค่าที่ต้องการดำเนินการ' : 'Search and select desired settings module'}
                </p>
              </div>

              {/* Instant Search input */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text/40 pointer-events-none" />
                <input
                  type="text"
                  value={navSearchQuery}
                  onChange={(e) => setNavSearchQuery(e.target.value)}
                  placeholder={language === 'th' ? 'พิมพ์ค้นหาเมนู...' : 'Type to search...'}
                  className="w-full pl-8 pr-8 py-1.5 text-xs rounded-xl border border-border bg-background text-text placeholder:text-text/40 focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  autoFocus
                />
                {navSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setNavSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text/40 hover:text-text"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Categorized Menu Options (List or Grid View) */}
            <div className="space-y-4">
              {categories.map((cat) => {
                const catTabs = tabItems.filter((t) => {
                  if (t.category !== cat.id) return false;
                  if (categoryFilter !== 'all' && categoryFilter !== cat.id) return false;
                  if (!navSearchQuery) return true;
                  const q = navSearchQuery.toLowerCase();
                  return (
                    t.label.th.toLowerCase().includes(q) ||
                    t.label.en.toLowerCase().includes(q) ||
                    t.sublabel.th.toLowerCase().includes(q) ||
                    t.sublabel.en.toLowerCase().includes(q)
                  );
                });

                if (catTabs.length === 0) return null;
                const CatHeaderIcon = getLucideIcon(cat.iconName);

                return (
                  <div key={cat.id} className="space-y-2">
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
                      <div className="flex items-center gap-2">
                        <CatHeaderIcon className="w-4 h-4" />
                        <span className="text-xs font-black uppercase tracking-wider">
                          {cat.label[language === 'th' ? 'th' : 'en']}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/15">
                        {catTabs.length} items
                      </span>
                    </div>

                    <div
                      className={
                        viewMode === 'grid'
                          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5'
                          : 'space-y-1.5'
                      }
                    >
                      {catTabs.map((tab) => {
                        const isSelected = activeTab === tab.id;
                        const ItemIcon = getLucideIcon(tab.iconName);

                        const hasDirty =
                          (tab.id === 'general' && isStoreDirty) ||
                          (tab.id === 'appearance' && isCfdDirty) ||
                          (tab.id === 'tax_accounting' && isTaxDirty) ||
                          (tab.id === 'security_roles' && isSecurityDirty);

                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setActiveTab(tab.id);
                              setIsOpen(false);
                            }}
                            className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isSelected
                                ? 'bg-primary text-white border-primary shadow-md font-bold'
                                : 'bg-background/80 hover:bg-card hover:border-primary/40 border-border/80 text-text'
                            }`}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div
                                className={`p-2 rounded-xl shrink-0 ${
                                  isSelected
                                    ? 'bg-white/20 text-white'
                                    : 'bg-primary/10 text-primary border border-primary/20'
                                }`}
                              >
                                <ItemIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-text'}`}>
                                    {tab.label[language === 'th' ? 'th' : 'en']}
                                  </span>
                                  {tab.badge && (
                                    <span
                                      className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                                        isSelected ? 'bg-white/25 text-white' : 'bg-primary/15 text-primary'
                                      }`}
                                    >
                                      {tab.badge}
                                    </span>
                                  )}
                                  {hasDirty && (
                                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
                                  )}
                                </div>
                                <p
                                  className={`text-[11px] line-clamp-1 mt-0.5 ${
                                    isSelected ? 'text-white/80' : 'text-text/60'
                                  }`}
                                >
                                  {tab.sublabel[language === 'th' ? 'th' : 'en']}
                                </p>
                              </div>
                            </div>

                            {isSelected && (
                              <div className="w-5 h-5 rounded-full bg-white text-primary flex items-center justify-center shrink-0 shadow-2xs">
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
