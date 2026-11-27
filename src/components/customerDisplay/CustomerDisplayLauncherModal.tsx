import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { CustomerDisplayView } from '../../modules/customerDisplay/CustomerDisplayView';
import {
  Monitor,
  ExternalLink,
  Sparkles,
  Maximize2,
  Tv,
  CheckCircle2,
} from 'lucide-react';

export interface CustomerDisplayLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerDisplayLauncherModal: React.FC<CustomerDisplayLauncherModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();

  const handleOpenDualWindow = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=customer-display`;
    const newWindow = window.open(
      url,
      'ProdxCustomerDisplay',
      'width=1080,height=720,menubar=no,toolbar=no,location=no,status=no'
    );

    if (newWindow) {
      addToast({
        title: language === 'th' ? 'เปิดจอฝั่งลูกค้าสำเร็จ' : 'Customer Display Opened',
        message:
          language === 'th'
            ? 'ลากหน้าต่างนี้ไปยังจอมอนิเตอร์ที่ 2 (ฝั่งลูกค้า) แล้วกด F11 ขยายเต็มจอ'
            : 'Move the new window to your 2nd monitor and press F11 for fullscreen.',
        type: 'success',
      });
      onClose();
    } else {
      addToast({
        title: language === 'th' ? 'บราวเซอร์บล็อกป็อปอัป' : 'Popup Blocked',
        message:
          language === 'th'
            ? 'โปรดอนุญาต Pop-up บนเบราว์เซอร์เพื่อเปิดหน้าต่างจอฝั่งลูกค้า'
            : 'Please allow popups in your browser to launch dual display.',
        type: 'warning',
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        language === 'th'
          ? 'จอแสดงผลฝั่งลูกค้า (Customer-Facing Display / Dual Screen)'
          : 'Customer-Facing Display (CFD)'
      }
      description={
        language === 'th'
          ? 'ระบบซิงก์ข้อมูลสองหน้าจอแบบเรียลไทม์ แสดงรายการสแกน ยอดเงิน และ QR Code พร้อมเพย์'
          : 'Real-time dual monitor sync displaying scanned items, price breakdowns, and PromptPay QR.'
      }
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full text-xs text-text/60">
          <div>
            {language === 'th'
              ? 'รองรับ BroadcastChannel API และ localStorage ซิงก์ได้แม้ไม่มีอินเทอร์เน็ต'
              : 'Powered by BroadcastChannel & LocalStorage for offline dual-screen.'}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            {language === 'th' ? 'ปิด' : 'Close'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 select-none">
        {/* Quick Launch Action Banner */}
        <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary text-primary-foreground">
              <Tv className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text">
                {language === 'th' ? 'เปิดหน้าต่างจอที่ 2 (Dual Monitor Window)' : 'Launch 2nd Monitor Window'}
              </div>
              <div className="text-xs text-text/70">
                {language === 'th'
                  ? 'คลิกเพื่อเปิดหน้าต่างแยกและลากไปยังจอที่ 2 ฝั่งลูกค้า'
                  : 'Opens a dedicated window synchronized with this POS instance.'}
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenDualWindow}
            leftIcon={<ExternalLink className="h-4 w-4" />}
          >
            {language === 'th' ? 'เปิดจอฝั่งลูกค้า (Pop-up)' : 'Open Dual Screen'}
          </Button>
        </div>

        {/* Live In-App Simulator Frame */}
        <div>
          <div className="text-xs font-semibold text-text/60 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>{language === 'th' ? 'ภาพตัวอย่างสด (Live Simulator):' : 'Live In-App Preview:'}</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {language === 'th' ? 'กำลังซิงก์สด' : 'Live Sync Active'}
            </span>
          </div>

          <div className="w-full h-80 rounded-lg border border-border border-crisp overflow-hidden shadow-xs relative bg-card">
            <div className="w-[125%] h-[125%] origin-top-left scale-80 pointer-events-none">
              <CustomerDisplayView />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
