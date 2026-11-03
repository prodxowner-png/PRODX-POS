import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { RbacGuard } from '../../../components/auth/RbacGuard';
import { OrganizationManagementModule } from '../../admin/OrganizationManagementModule';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';

export const SystemConfigTab: React.FC = () => {
  const { language } = useLanguage();
  const isThai = language === 'th';

  const handleOpenDedicatedAdminConsole = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <RbacGuard
      settingsTab="system_config"
      requiredRole="admin"
      requiredPermissions={['org:manage']}
      isOrganizationLevel
      hideMode="denied-card"
    >
      <div className="space-y-4">
        {/* Executive Organization Governance Banner */}
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="primary" size="xs" className="font-mono uppercase">
                <ShieldCheck className="h-3 w-3 mr-1 inline" />
                {isThai ? 'สิทธิ์ผู้ดูแลระบบสูงสุด (ADMIN VERIFIED)' : 'ENTERPRISE ADMIN VERIFIED'}
              </Badge>
              <span className="text-xs font-bold text-text">
                {isThai
                  ? 'การตั้งค่าระดับองค์กร สาขา และเครื่องขาย POS ทั้งหมด'
                  : 'Full Organization, Branch & POS Terminal Governance'}
              </span>
            </div>
            <p className="text-xs text-text/70">
              {isThai
                ? 'คุณกำลังเข้าใช้งานด้วยสิทธิ์ Admin ซึ่งสามารถสร้าง แก้ไข ลบ และตรวจสอบบันทึก Audit Log ขององค์กร สาขา และเครื่องขาย POS ได้ครบ 100%'
                : 'You are authenticated as an Administrator with full CRUD and real-time Audit Log access across all Organizations, Store Branches, and POS Terminals.'}
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleOpenDedicatedAdminConsole}
            leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            className="shrink-0 font-bold text-xs cursor-pointer"
          >
            {isThai ? 'เปิด Admin Console เต็มจอ (/admin)' : 'Open Full Admin Console (/admin)'}
          </Button>
        </div>

        {/* Full Live Firestore Organization, Branch & Terminal Management Module */}
        <OrganizationManagementModule initialTab="organizations" />
      </div>
    </RbacGuard>
  );
};
