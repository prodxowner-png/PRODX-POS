import React from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { Shield, UserCheck } from 'lucide-react';
import { Badge } from '../../../components/common/Badge';

interface RolePerspectiveBannerProps {
  isManager: boolean;
  userRole: string;
}

export const RolePerspectiveBanner: React.FC<RolePerspectiveBannerProps> = ({ isManager, userRole }) => {
  const { language } = useLanguage();

  return (
    <div id="dashboard-role-perspective-banner" className={`p-3.5 sm:p-4 rounded-xl border border-crisp shadow-2xs transition-all ${isManager ? 'bg-primary/5 border-primary/20 text-text' : 'bg-emerald-500/5 border-emerald-500/20 text-text'}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${isManager ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
          {isManager ? <Shield className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-text tracking-wide">
              {isManager ? (language === 'th' ? 'มุมมองผู้จัดการ & บริหาร (Manager Perspective)' : 'Manager & Leadership Perspective') : (language === 'th' ? 'มุมมองพนักงานหน้าร้าน (Staff Perspective)' : 'Frontline Staff Perspective')}
            </span>
            <Badge variant={isManager ? 'primary' : 'success'} size="sm" className="font-mono text-[10px] uppercase font-bold">{userRole}</Badge>
            <span className="text-[11px] text-brand-text-secondary hidden sm:inline">•</span>
            <span className="text-[11px] font-medium text-text/70">
              {isManager ? (language === 'th' ? 'สิทธิ์รายงานการเงิน & ยอดขายเต็มรูปแบบ' : 'Financial KPIs & Revenue Analytics') : (language === 'th' ? 'เน้นข้อมูลเชิงปฏิบัติการ & สต็อกหน้าร้าน (ซ่อนข้อมูลการเงิน)' : 'Operational Throughput & Units Sold (Financials Masked)')}
            </span>
          </div>
          <p className="text-[11px] text-text/60 mt-0.5 truncate">
            {isManager ? (language === 'th' ? 'แสดงยอดขายสุทธิ มูลค่าตะกร้าเฉลี่ย ยอดรับเงินสด/ดิจิทัล และกราฟความเร็วการขายเชิงมูลค่าเงิน' : 'Displaying net revenue, average order value, tender breakdown, and monetary sales velocity.') : (language === 'th' ? 'แสดงจำนวนคำสั่งซื้อ จำนวนชิ้นที่ขาย ความเร็วรอบการขาย และช่วงเวลาพีค เพื่อรักษาความลับทางการเงินของร้าน' : 'Displaying order counts, units scanned, peak rush hours, and drawer readiness without exposing profit or margins.')}
          </p>
        </div>
      </div>
    </div>
  );
};