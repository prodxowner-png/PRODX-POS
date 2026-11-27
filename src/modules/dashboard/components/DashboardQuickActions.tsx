import React from 'react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { NavRoute } from '../../../components/layout/Sidebar';
import {
  Sparkles,
  ShoppingCart,
  Banknote,
  Boxes,
  Users,
  ArrowUpRight,
} from 'lucide-react';

interface DashboardQuickActionsProps {
  onNavigate: (route: NavRoute) => void;
}

export const DashboardQuickActions: React.FC<DashboardQuickActionsProps> = ({
  onNavigate,
}) => {
  const { language, t } = useLanguage();
  const { session } = useAuth();

  return (
    <Card id="dashboard-quick-actions-card" className="w-full flex flex-col justify-between shadow-2xs">
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <h3 className="text-sm sm:text-base font-bold text-text flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>{language === 'th' ? 'เมนูลัดการทำงาน' : 'Operational Quick Actions'}</span>
          </h3>
          <Badge variant="primary" size="sm">
            Fast Flow
          </Badge>
        </div>
      </CardHeader>

      <CardBody className="p-3 sm:p-4 space-y-2 sm:space-y-2.5 flex-1 flex flex-col justify-between">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {/* Action 1: POS Screen */}
          <button
            type="button"
            id="quick-action-pos"
            onClick={() => onNavigate('pos')}
            className="w-full p-3 rounded-lg border-border border-crisp hover:border-primary/40 bg-background hover:bg-card flex items-center justify-between text-left transition-all cursor-pointer group shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text group-hover:text-primary truncate">
                  {language === 'th' ? 'เปิดหน้าขาย POS Terminal (F1)' : 'Open POS Terminal (F1)'}
                </div>
                <div className="text-[11px] text-text/70 truncate">
                  {language === 'th' ? 'สแกนบาร์โค้ด & คิดเงินลูกค้า' : 'Ring up sales & barcode scan'}
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-brand-text-secondary group-hover:text-primary shrink-0" />
          </button>

          {/* Action 2: Shift Drawer */}
          <button
            type="button"
            id="quick-action-shift"
            onClick={() => onNavigate('shift')}
            className="w-full p-3 rounded-lg border-border border-crisp hover:border-emerald-500/40 bg-background hover:bg-card flex items-center justify-between text-left transition-all cursor-pointer group shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Banknote className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text group-hover:text-emerald-600 dark:group-hover:text-emerald-400 truncate">
                  {language === 'th' ? 'กะการทำงาน & เงินสดยกมา' : 'Cash Drawer & Shifts'}
                </div>
                <div className="text-[11px] text-text/70 truncate">
                  {language === 'th' ? 'นำเงินเข้า / จ่ายออก / ปิดกะ' : 'Float, pay in/out & reconcile'}
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-brand-text-secondary group-hover:text-emerald-600 shrink-0" />
          </button>

          {/* Action 3: Inventory Stock */}
          <button
            type="button"
            id="quick-action-inventory"
            onClick={() => onNavigate('inventory')}
            className="w-full p-3 rounded-lg border-border border-crisp hover:border-primary/40 bg-background hover:bg-card flex items-center justify-between text-left transition-all cursor-pointer group shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-brand-surface-selected text-brand-text-accent flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Boxes className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text group-hover:text-brand-text-accent truncate">
                  {t.inventory.title}
                </div>
                <div className="text-[11px] text-text/70 truncate">
                  {language === 'th' ? 'ปรับสต็อก & บัญชีแยกประเภท' : 'Stock ledger & adjust counts'}
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-brand-text-secondary group-hover:text-brand-text-accent shrink-0" />
          </button>

          {/* Action 4: Customers CRM */}
          <button
            type="button"
            id="quick-action-customers"
            onClick={() => onNavigate('customers')}
            className="w-full p-3 rounded-lg border-border border-crisp hover:border-blue-500/40 bg-background hover:bg-card flex items-center justify-between text-left transition-all cursor-pointer group shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text group-hover:text-blue-500 truncate">
                  {language === 'th' ? 'ระบบสมาชิกลูกค้า' : 'Customer Loyalty CRM'}
                </div>
                <div className="text-[11px] text-text/70 truncate">
                  {language === 'th' ? 'สะสมแต้ม & ประวัติการซื้อ' : 'Points, tiers & member cards'}
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-brand-text-secondary group-hover:text-blue-500 shrink-0" />
          </button>
        </div>

        {/* Hardware Diagnostic Bar */}
        <div className="mt-3 p-2.5 rounded-lg bg-background border-border border-crisp flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-semibold text-text">
              {language === 'th' ? 'อุปกรณ์ POS ออนไลน์' : 'POS Hardware Online'}
            </span>
          </div>
          <span className="text-brand-text-secondary font-mono text-[11px]">
            {session?.registerId || 'POS-01'}
          </span>
        </div>
      </CardBody>
    </Card>
  );
};
