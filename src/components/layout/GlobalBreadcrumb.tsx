import React from 'react';
import {
  ShoppingCart,
  LayoutGrid,
  ReceiptText,
  Boxes,
  Banknote,
  Users,
  ShieldCheck,
  Settings,
  ChevronRight,
  Home,
  Store,
  Layers,
  ArrowLeft,
  ChefHat,
  Zap,
} from 'lucide-react';
import { NavRoute } from './Sidebar';
import { useBreadcrumb, BreadcrumbLevel } from '../../context/BreadcrumbContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../common/Badge';

export interface GlobalBreadcrumbProps {
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  className?: string;
}

interface RouteMeta {
  id: NavRoute;
  label: { th: string; en: string };
  icon: React.ComponentType<{ className?: string }>;
}

const ROUTE_META: Record<NavRoute, RouteMeta> = {
  pos: {
    id: 'pos',
    label: { th: 'ขายหน้าร้าน (POS)', en: 'POS Register' },
    icon: ShoppingCart,
  },
  kds: {
    id: 'kds',
    label: { th: 'จอแสดงในครัว (KDS)', en: 'Kitchen Display' },
    icon: ChefHat,
  },
  inventory: {
    id: 'inventory',
    label: { th: 'คลังสินค้า (Inventory)', en: 'Inventory & Stock' },
    icon: Boxes,
  },
  settings: {
    id: 'settings',
    label: { th: 'การตั้งค่า (Settings)', en: 'System Settings' },
    icon: Settings,
  },
  dashboard: {
    id: 'dashboard',
    label: { th: 'ภาพรวม (Dashboard)', en: 'Dashboard' },
    icon: LayoutGrid,
  },
  orders: {
    id: 'orders',
    label: { th: 'ประวัติขาย (Orders)', en: 'Order Receipts' },
    icon: ReceiptText,
  },
  shift: {
    id: 'shift',
    label: { th: 'การเปิดกะ (Shift)', en: 'Shift & Drawer' },
    icon: Banknote,
  },
  customers: {
    id: 'customers',
    label: { th: 'สมาชิก (CRM)', en: 'Customers & CRM' },
    icon: Users,
  },
  audit: {
    id: 'audit',
    label: { th: 'ประวัติความปลอดภัย', en: 'Audit Logs' },
    icon: ShieldCheck,
  },
  infrastructure: {
    id: 'infrastructure',
    label: { th: 'ระบบ AI และอุปกรณ์', en: 'Antigravity AI & PnP' },
    icon: Zap,
  },
  tasks: {
    id: 'tasks',
    label: { th: 'รายการงาน (Tasks)', en: 'Task Manager' },
    icon: LayoutGrid,
  },
  kitchen: {
    id: 'kitchen',
    label: { th: 'ระบบครัว (Kitchen)', en: 'Kitchen System' },
    icon: ChefHat,
  },
  admin: {
    id: 'admin',
    label: { th: 'ผู้ดูแลระบบ (Admin)', en: 'Administrator Console' },
    icon: ShieldCheck,
  },
};

export const GlobalBreadcrumb: React.FC<GlobalBreadcrumbProps> = ({
  currentRoute,
  onNavigate,
  className = '',
}) => {
  const { subLevels, clearSubLevels } = useBreadcrumb();
  const { language } = useLanguage();
  const { session } = useAuth();

  const currentRouteMeta = ROUTE_META[currentRoute] || ROUTE_META.pos;
  const RouteIcon = currentRouteMeta.icon;

  const handleRootClick = () => {
    clearSubLevels();
    onNavigate(currentRoute);
  };

  const getLabelString = (lbl: string | { th: string; en: string }) => {
    if (typeof lbl === 'string') return lbl;
    return lbl[language] || lbl.en || lbl.th;
  };

  return (
    <div
      aria-label="Breadcrumb navigation"
      className={`bg-card/90 backdrop-blur-md border-b border-border/60 px-3 sm:px-6 py-1 sm:py-1.5 flex items-center justify-between text-xs min-w-0 w-full select-none shadow-2xs ${className}`}
    >
      {/* Left: Interactive Breadcrumb Path Trail */}
      <nav className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-x-auto no-scrollbar py-0.5">
        {/* Step 0: Root Module Icon & Title Button */}
        <button
          type="button"
          onClick={handleRootClick}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-text/70 hover:text-primary hover:bg-primary/10 transition-all duration-150 cursor-pointer font-bold shrink-0 text-xs active:scale-95"
          title={language === 'th' ? `กลับสู่หน้าแรกของ ${currentRouteMeta.label.th}` : `Go to ${currentRouteMeta.label.en} root`}
        >
          <RouteIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="truncate max-w-[120px] sm:max-w-[180px]">
            {currentRouteMeta.label[language]}
          </span>
        </button>

        {/* Dynamic Sub-Level Breadcrumbs */}
        {subLevels.map((level, idx) => {
          const isLast = idx === subLevels.length - 1;
          const LevelIcon = level.icon;
          const levelLabel = getLabelString(level.label);

          return (
            <React.Fragment key={level.id || `level-${idx}`}>
              <ChevronRight className="h-3.5 w-3.5 text-text/30 shrink-0" />

              {isLast ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary font-bold text-xs shrink-0 shadow-2xs">
                  {LevelIcon && <LevelIcon className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate max-w-[140px] sm:max-w-[220px]">
                    {levelLabel}
                  </span>
                  {level.badge !== undefined && (
                    <Badge variant="primary" size="sm" className="ml-0.5 font-mono text-[10px] px-1.5 py-0">
                      {level.badge}
                    </Badge>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (level.onClick) {
                      level.onClick();
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-text/70 hover:text-text hover:bg-background/80 transition-all duration-150 font-semibold text-xs shrink-0 ${
                    level.onClick ? 'cursor-pointer active:scale-95' : 'cursor-default'
                  }`}
                >
                  {LevelIcon && <LevelIcon className="h-3.5 w-3.5 text-text/50 shrink-0" />}
                  <span className="truncate max-w-[120px] sm:max-w-[180px]">
                    {levelLabel}
                  </span>
                  {level.badge !== undefined && (
                    <Badge variant="neutral" size="sm" className="ml-0.5 font-mono text-[10px] px-1.5 py-0">
                      {level.badge}
                    </Badge>
                  )}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right: Store Context Indicator & Navigation Quick Info */}
      <div className="hidden md:flex items-center gap-2 pl-3 shrink-0 text-[11px] font-mono text-text/50 border-l border-border/50">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-background border border-border/60">
          <Store className="h-3 w-3 text-primary/70 shrink-0" />
          <span className="font-bold text-text/80">{session?.currentStore?.code}</span>
        </div>
        <span className="hidden lg:inline text-[10px] text-text/40">
          {session?.registerId}
        </span>
      </div>
    </div>
  );
};
