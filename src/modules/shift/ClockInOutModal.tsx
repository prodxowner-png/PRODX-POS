import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { useLanguage } from '../../context/LanguageContext';
import { Clock, ShieldCheck, UserCheck, KeyRound } from 'lucide-react';
import { createShiftApi } from '../../adapters/productionShiftApiFactory';
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
  const shiftApi = session ? createShiftApi(session.token) : null;
  
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<'in' | 'out'>('in');

  if (!session) return null;

  const handleNumpad = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (pin.length !== 4) return;
    
    setIsSubmitting(true);
    try {
      let record;
      if (mode === 'in') {
        record = await shiftApi!.clockIn(pin, session.currentStore.id);
        addToast({
          title: language === 'th' ? 'ลงเวลาเข้าสำเร็จ' : 'Clocked In Successfully',
          message: `${record.userName} clocked in at ${new Date(record.clockedInAt).toLocaleTimeString()}`,
          type: 'success',
        });
      } else {
        record = await shiftApi!.clockOut(pin, session.currentStore.id);
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
      setPin(''); // Reset on failure
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPin('');
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

        {/* PIN Dots */}
        <div className="flex justify-center gap-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                index < pin.length 
                  ? 'bg-primary scale-110 shadow-xs' 
                  : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="text-[11px] text-text/50 font-mono h-4">
          Production timeclock PIN verification is not yet wired to the server credential boundary.
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleNumpad(num)}
              className="h-12 rounded-lg border-crisp border border-border bg-card flex items-center justify-center text-lg font-mono font-semibold text-text hover:bg-background active:scale-95 transition-all cursor-pointer"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleBackspace}
            className="h-12 rounded-lg border-crisp border border-border bg-card flex items-center justify-center text-xs font-semibold text-text/70 hover:bg-background active:scale-95 transition-all cursor-pointer"
          >
            DEL
          </button>
          <button
            type="button"
            onClick={() => handleNumpad('0')}
            className="h-12 rounded-lg border-crisp border border-border bg-card flex items-center justify-center text-lg font-mono font-semibold text-text hover:bg-background active:scale-95 transition-all cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pin.length !== 4 || isSubmitting}
            className={`h-12 rounded-lg flex items-center justify-center text-xs font-semibold active:scale-95 transition-all ${
              pin.length === 4 
                ? 'bg-primary text-white shadow-xs hover:opacity-90 cursor-pointer' 
                : 'bg-card text-text/50 cursor-not-allowed border-crisp border border-border'
            }`}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
};
