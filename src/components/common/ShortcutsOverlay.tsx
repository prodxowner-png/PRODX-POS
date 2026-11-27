import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Keyboard,
  Search,
  X,
  Compass,
  Zap,
  Sliders,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { playScannerSound } from '../../services/soundService';
import { NavRoute } from '../layout/Sidebar';
import { useRbac } from '../auth/RbacGuard';
import { getZIndexClass } from '../../utils/ZIndexManager';

export interface ShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (route: NavRoute) => void;
}

interface ShortcutItem {
  id: string;
  category: 'nav' | 'pos' | 'global';
  keyDisplay: string[];
  labelEn: string;
  labelTh: string;
  descEn: string;
  descTh: string;
  route?: NavRoute;
}

export const ShortcutsOverlay: React.FC<ShortcutsOverlayProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { language } = useLanguage();
  const { canAccessModule } = useRbac();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'nav' | 'pos' | 'global'>('all');
  const [activeKeyHighlight, setActiveKeyHighlight] = useState<string | null>(null);
  const [lastDetectedKey, setLastDetectedKey] = useState<string | null>(null);

  const shortcutsList: ShortcutItem[] = useMemo(
    () => [
      // Navigation Shortcuts (F1 - F8)
      {
        id: 'F1',
        category: 'nav',
        keyDisplay: ['F1'],
        labelEn: 'POS Cash Register',
        labelTh: 'หน้าขาย / แคชเชียร์',
        descEn: 'Instant switch to checkout terminal & product grid',
        descTh: 'สลับไปยังหน้าจอขายหลักและตะกร้าสินค้าทันที',
        route: 'pos',
      },
      {
        id: 'F2',
        category: 'nav',
        keyDisplay: ['F2'],
        labelEn: 'Executive Dashboard',
        labelTh: 'แดชบอร์ดบริหาร',
        descEn: 'View sales velocity, revenue metrics & analytics',
        descTh: 'ดูภาพรวมยอดขาย สถิติ และกราฟวิเคราะห์ธุรกิจ',
        route: 'dashboard',
      },
      {
        id: 'F3',
        category: 'nav',
        keyDisplay: ['F3'],
        labelEn: 'Orders & Receipts',
        labelTh: 'ประวัติคำสั่งซื้อ & ใบเสร็จ',
        descEn: 'Browse completed transactions, reprints & refunds',
        descTh: 'ค้นหาประวัติการขาย พิมพ์ใบเสร็จซ้ำ และจัดการคืนเงิน',
        route: 'orders',
      },
      {
        id: 'F4',
        category: 'nav',
        keyDisplay: ['F4'],
        labelEn: 'Cash Float & Shift',
        labelTh: 'ควบคุมกะ & ลิ้นชักเงินสด',
        descEn: 'Open/close register shifts and balance cash float',
        descTh: 'เปิด-ปิดกะทำงาน ตรวจนับเงินสด และจัดการเงินทอน',
        route: 'shift',
      },
      {
        id: 'F5',
        category: 'nav',
        keyDisplay: ['F5'],
        labelEn: 'Inventory Catalog',
        labelTh: 'คลังสินค้า & สต็อก',
        descEn: 'Search SKUs, adjust inventory counts & barcode tags',
        descTh: 'ตรวจสอบจำนวนสต็อก แก้ไขราคา และพิมพ์ป้ายบาร์โค้ด',
        route: 'inventory',
      },
      {
        id: 'F6',
        category: 'nav',
        keyDisplay: ['F6'],
        labelEn: 'Customer CRM & Loyalty',
        labelTh: 'ข้อมูลลูกค้า & สะสมแต้ม',
        descEn: 'Look up member profiles, tiers & reward balances',
        descTh: 'ค้นหาประวัติสมาชิก ตรวจสอบคะแนนสะสม และสิทธิพิเศษ',
        route: 'customers',
      },
      {
        id: 'F7',
        category: 'nav',
        keyDisplay: ['F7'],
        labelEn: 'Security Audit Trail',
        labelTh: 'บันทึกความปลอดภัย (Audit)',
        descEn: 'Review cashier activity logs and supervisor overrides',
        descTh: 'ตรวจสอบบันทึกความปลอดภัยและการอนุมัติของหัวหน้างาน',
        route: 'audit',
      },
      {
        id: 'F8',
        category: 'nav',
        keyDisplay: ['F8'],
        labelEn: 'Hardware & Store Settings',
        labelTh: 'ตั้งค่าระบบ & อุปกรณ์',
        descEn: 'Configure printers, themes, tax rates & currencies',
        descTh: 'ตั้งค่าเครื่องพิมพ์ใบเสร็จ ธีม อัตราภาษี และสกุลเงิน',
        route: 'settings',
      },
      {
        id: 'F10',
        category: 'nav',
        keyDisplay: ['F10'],
        labelEn: 'Kitchen Display (KDS)',
        labelTh: 'จอแสดงออเดอร์ในครัว (KDS)',
        descEn: 'Track order preparation tickets & kitchen status',
        descTh: 'ติดตามตั๋วรายการอาหาร กำลังปรุง และพร้อมเสิร์ฟ',
        route: 'kds',
      },

      // Global & Action Shortcuts
      {
        id: 'F9',
        category: 'global',
        keyDisplay: ['F9'],
        labelEn: 'Shortcuts Overlay',
        labelTh: 'หน้าต่างทางลัดคีย์บอร์ด',
        descEn: 'Toggle this interactive cheat sheet overlay',
        descTh: 'เปิด/ปิดหน้าต่างแสดงทางลัดคีย์บอร์ดนี้',
      },
      {
        id: 'Ctrl+Shift+D',
        category: 'global',
        keyDisplay: ['Ctrl', 'Shift', 'D'],
        labelEn: 'Developer HUD Overlay',
        labelTh: 'เปิดหน้าต่างนักพัฒนา (Developer HUD)',
        descEn: 'Real-time FPS, IndexedDB / API latency, V8 memory heap, and benchmark tools (⌘⇧D on macOS)',
        descTh: 'แสดงอัตราเฟรมเรต Real-time, ความเร็วการคิวรีฐานข้อมูล (Latency) และการใช้หน่วยความจำ RAM',
      },
      {
        id: 'Ctrl+K',
        category: 'global',
        keyDisplay: ['Ctrl', 'K'],
        labelEn: 'Quick Command Palette',
        labelTh: 'กล่องค้นหาและคำสั่งด่วน (Palette)',
        descEn: 'Universal search across products, navigation & actions (⌘K on macOS)',
        descTh: 'ค้นหาสินค้า สลับเมนู และเรียกใช้คำสั่งด่วนทั่วทั้งระบบ',
      },
      {
        id: 'Escape',
        category: 'global',
        keyDisplay: ['ESC'],
        labelEn: 'Dismiss / Close Dialog',
        labelTh: 'ปิดหน้าต่าง / ยกเลิก',
        descEn: 'Close any active modal, cancel selection, or clear search',
        descTh: 'ปิดหน้าต่างป็อปอัปที่เปิดอยู่ ยกเลิกการเลือก หรือล้างการค้นหา',
      },

      // POS Operational Shortcuts
      {
        id: 'Enter',
        category: 'pos',
        keyDisplay: ['Enter'],
        labelEn: 'Confirm / Add Item',
        labelTh: 'ยืนยัน / เพิ่มสินค้า',
        descEn: 'Submit barcode scan input, add focused item, or accept prompts',
        descTh: 'ยืนยันรหัสบาร์โค้ดที่สแกน เพิ่มสินค้าลงตะกร้า หรือตกลงการทำรายการ',
      },
      {
        id: 'Tab',
        category: 'pos',
        keyDisplay: ['Tab'],
        labelEn: 'Focus Next Field',
        labelTh: 'ไปยังช่องถัดไป',
        descEn: 'Advance keyboard focus to next input or action button',
        descTh: 'เลื่อนตำแหน่งการพิมพ์ไปยังช่องหรือปุ่มถัดไป',
      },
      {
        id: 'Shift+Tab',
        category: 'pos',
        keyDisplay: ['Shift', 'Tab'],
        labelEn: 'Focus Previous Field',
        labelTh: 'ย้อนกลับไปยังช่องก่อนหน้า',
        descEn: 'Move keyboard focus backward to previous input control',
        descTh: 'เลื่อนตำแหน่งการพิมพ์ย้อนกลับไปยังช่องก่อนหน้า',
      },
    ],
    []
  );

  // Keyboard listener when overlay is open: test & highlight keys or dismiss with ESC/F9
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC closes modal
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // F9 toggles modal close
      if (e.key === 'F9') {
        e.preventDefault();
        onClose();
        return;
      }

      // Detect which shortcut was pressed for live visual feedback
      let matchId: string | null = null;
      if (e.key.startsWith('F') && ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].includes(e.key)) {
        matchId = e.key;
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        matchId = 'Ctrl+K';
      } else if (e.key === 'Enter') {
        matchId = 'Enter';
      } else if (e.key === 'Tab') {
        matchId = e.shiftKey ? 'Shift+Tab' : 'Tab';
      }

      if (matchId) {
        setLastDetectedKey(matchId);
        setActiveKeyHighlight(matchId);
        try {
          playScannerSound('click');
        } catch {
          // ignore sound errors
        }

        const timer = setTimeout(() => {
          setActiveKeyHighlight(null);
        }, 900);
        return () => clearTimeout(timer);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock scrollbar while modal is visible
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setSearchQuery('');
      setSelectedCategory('all');
      setActiveKeyHighlight(null);
      setLastDetectedKey(null);
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const filteredShortcuts = useMemo(() => {
    return shortcutsList.filter((item) => {
      // Role-Based Access Control: Conditionally hide sensitive financial module shortcuts
      if (item.route && !canAccessModule(item.route)) {
        return false;
      }

      // Category filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesKey = item.keyDisplay.some((k) => k.toLowerCase().includes(query));
        const matchesEn =
          item.labelEn.toLowerCase().includes(query) || item.descEn.toLowerCase().includes(query);
        const matchesTh =
          item.labelTh.toLowerCase().includes(query) || item.descTh.toLowerCase().includes(query);
        return matchesKey || matchesEn || matchesTh;
      }

      return true;
    });
  }, [shortcutsList, selectedCategory, searchQuery]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="shortcuts-overlay-backdrop"
      className={`fixed inset-0 ${getZIndexClass('modal')} flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in duration-150`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-overlay-title"
    >
      <div
        id="shortcuts-overlay-modal"
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg bg-card text-text border border-border border-crisp shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border border-crisp bg-card shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 border-crisp flex items-center justify-center text-primary shrink-0">
              <Keyboard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="shortcuts-overlay-title"
                  className="text-sm sm:text-base font-semibold text-text tracking-tight truncate leading-tight"
                >
                  {language === 'th' ? 'ทางลัดคีย์บอร์ดทั้งหมด' : 'Keyboard Shortcuts'}
                </h2>
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-lg text-[10px] font-mono tabular-nums font-bold bg-primary/10 text-primary border border-primary/25 border-crisp">
                  F9
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-text/60 truncate mt-0.5 leading-snug">
                {language === 'th'
                  ? 'คู่มือคีย์ลัดสำหรับนำทางและควบคุมระบบ POS อย่างรวดเร็ว'
                  : 'Quick reference for fast cashier navigation & operational controls'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-brand-text-secondary font-mono tabular-nums">
              <span>{language === 'th' ? 'กด' : 'Press'}</span>
              <kbd className="px-1.5 py-0.5 rounded-lg bg-background border border-border border-crisp font-semibold">
                ESC
              </kbd>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-brand-text-secondary hover:text-text hover:bg-background border border-transparent hover:border-border hover:border-crisp transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Close shortcuts overlay"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="px-5 py-3 border-b border-border border-crisp bg-background/50 shrink-0 space-y-2.5">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'th'
                  ? 'ค้นหาทางลัด (เช่น F1, คลังสินค้า, ESC, Enter)...'
                  : 'Search shortcuts (e.g., F1, Inventory, ESC, Enter)...'
              }
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-card text-text border border-border border-crisp text-xs placeholder:text-brand-text-secondary focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-text-secondary hover:text-text p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
            {[
              { id: 'all', labelEn: 'All Shortcuts', labelTh: 'ทั้งหมด', icon: Sliders },
              { id: 'nav', labelEn: 'Navigation (F1–F8)', labelTh: 'สลับหน้าจอ (F1–F8)', icon: Compass },
              { id: 'pos', labelEn: 'POS Actions', labelTh: 'การขาย & แคชเชียร์', icon: Zap },
              { id: 'global', labelEn: 'System & Dialogs', labelTh: 'ระบบ & หน้าต่าง', icon: Keyboard },
            ].map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border border-crisp ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                      : 'bg-card text-text/70 hover:text-text hover:bg-background border-border'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{language === 'th' ? cat.labelTh : cat.labelEn}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Key Detection Status Banner */}
        {lastDetectedKey && (
          <div className="px-5 py-2 bg-primary/5 border-b border-primary/20 border-crisp flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-2 text-primary font-semibold">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>
                {language === 'th' ? 'ตรวจพบคีย์จริง:' : 'Hardware Key Detected:'}
              </span>
              <kbd className="px-2 py-0.5 rounded-lg bg-primary text-primary-foreground font-mono tabular-nums text-[11px] font-bold shadow-2xs">
                {lastDetectedKey}
              </kbd>
            </div>
            <span className="text-[10px] text-text/60">
              {language === 'th' ? 'กำลังไฮไลต์รายการที่ตรงกัน' : 'Highlighting matching shortcut'}
            </span>
          </div>
        )}

        {/* Shortcuts List Content */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-2.5 bg-card">
          {filteredShortcuts.length === 0 ? (
            <div className="py-12 text-center space-y-2 text-text/60">
              <Keyboard className="w-8 h-8 mx-auto text-brand-text-secondary" />
              <p className="text-xs font-semibold">
                {language === 'th' ? 'ไม่พบทางลัดที่ตรงกับการค้นหา' : 'No keyboard shortcuts match your search'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="text-xs text-primary font-semibold hover:underline cursor-pointer"
              >
                {language === 'th' ? 'ล้างการค้นหา' : 'Reset filters'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredShortcuts.map((item) => {
                const isHighlighted = activeKeyHighlight === item.id;
                const canNavigate = Boolean(item.route && onNavigate);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (canNavigate && item.route && onNavigate) {
                        onNavigate(item.route);
                        onClose();
                      }
                    }}
                    className={`p-3 rounded-lg border border-crisp flex items-start gap-3 transition-all duration-150 ${
                      canNavigate ? 'cursor-pointer hover:border-primary/50 group' : ''
                    } ${
                      isHighlighted
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/30 shadow-xs'
                        : 'border-border bg-background/50 hover:bg-background text-text'
                    }`}
                  >
                    {/* Key Cap Badge Container */}
                    <div className="flex items-center gap-1 shrink-0 pt-0.5">
                      {item.keyDisplay.map((k, idx) => (
                        <React.Fragment key={idx}>
                          <kbd
                            className={`min-w-7 h-7 px-2 flex items-center justify-center font-mono tabular-nums text-xs font-bold rounded-lg border border-crisp transition-colors shadow-2xs ${
                              isHighlighted
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'bg-card border-border text-text'
                            }`}
                          >
                            {k}
                          </kbd>
                          {idx < item.keyDisplay.length - 1 && (
                            <span className="text-[11px] font-bold text-brand-text-secondary">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    {/* Label and description */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-xs font-semibold text-text truncate">
                          {language === 'th' ? item.labelTh : item.labelEn}
                        </div>
                        {canNavigate && (
                          <ArrowRight className="w-3 h-3 text-brand-text-secondary group-hover:text-primary transition-colors shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-text/60 line-clamp-2 mt-0.5 leading-snug">
                        {language === 'th' ? item.descTh : item.descEn}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border border-crisp bg-background/50 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-text/70 w-full sm:w-auto">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="truncate">
              {language === 'th'
                ? 'กดคีย์บอร์ดจริงเพื่อทดสอบปุ่ม หรือคลิกที่รายการเพื่อสลับหน้า'
                : 'Press hardware keys to test live, or click item to switch screen'}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-card hover:bg-background border border-border border-crisp text-xs font-semibold text-text transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {language === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
