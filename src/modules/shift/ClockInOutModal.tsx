import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { useLanguage } from '../../context/LanguageContext';
import { Clock, ShieldCheck, UserCheck } from 'lucide-react';
import { createShiftApi } from '../../adapters/shiftApiFactory';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { TimeclockRecord } from '../../domain/shift';

export interface ClockInOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (record: TimeclockRecord) => void;
}

export const ClockInOutModal: React.FC<ClockInOutModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const { session } = useAuth();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<'in' | 'out'>('in');

  if (!session) return null;

  const handleSubmit = async () => {
    if (!session?.token) return;
    setIsSubmitting(true);
    try {
      const shiftApi = createShiftApi(session.token);
      let record;
      if (mode === 'in') {
        record = await shiftApi.clockIn(session.currentStore.id);
        addToast({
          title: language === 'th' ? 'ลงเวลาเข้าสำเร็จ' : 'Clocked In Successfully',
          message: `${record.userName} clocked in at ${new Date(record.clockedInAt).toLocaleTimeString()}`,
          type: 'success',
        });
      } else {
        record = await shiftApi.clockOut(session.currentStore.id);
        addToast({
          title: language === 'th' ? 'ลงเวลาออกสำเร็จ' : 'Clocked Out Successfully',
          message: `${record.userName} clocked out at ${new Date(record.clockedOutAt!).toLocaleTimeString()}`,
          type: 'success',
        });
      }
      onSuccess(record);
      handleClose();
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ข้อผิดพลาด' : 'Error',
        message: err.message || 'Invalid PIN or already clocked in/out.',
        type: 'error',
      });
      // Server-authoritative session state is preserved; no local credential is stored.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setMode('in');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={language === 'th' ? 'ระบบลงเวลา (Timeclock)' : 'Timeclock'}
      description={language === 'th' ? 'กรุณากรอกรหัส PIN 4 หลักเพื่อลงเวลาเข้า-ออกงาน' : 'Enter your 4-digit PIN to clock in or out.'}
      maxWidth="sm"
    >
      <div className="space-y-5 flex flex-col items-center">
        {/* Mode toggle */}
        <div className="flex bg-card border-crisp border border-border p-1 rounded-lg w-full max-w-[240px]">
          <button
            type="button"
            onClick={() => setMode('in')}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-colors cursor-pointer ${
              mode === 'in' 
                ? 'bg-background shadow-xs text-text' 
                : 'text-text/70 hover:text-text'
            }`}
          >
            {language === 'th' ? 'เข้างาน (IN)' : 'Clock In'}
          </button>
          <button
            type="button"
            onClick={() => setMode('out')}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-colors cursor-pointer ${
              mode === 'out' 
                ? 'bg-background shadow-xs text-text' 
                : 'text-text/70 hover:text-text'
            }`}
          >
            {language === 'th' ? 'ออกงาน (OUT)' : 'Clock Out'}
          </button>
        </div>

        <div className="text-center space-y-2">
          <div className="text-sm font-semibold text-text">
            {session.currentUser.name}
          </div>
          <div className="text-[11px] text-text/60">
            {language === 'th' ? 'การลงเวลาจะยืนยันด้วยเซสชันที่เข้าสู่ระบบแล้ว' : 'Timeclock actions are authorized by your authenticated session.'}
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? '...' : (mode === 'in' ? (language === 'th' ? 'ยืนยันเข้างาน' : 'Confirm Clock In') : (language === 'th' ? 'ยืนยันออกงาน' : 'Confirm Clock Out'))}
        </Button>      </div>
    </Modal>
  );
};
