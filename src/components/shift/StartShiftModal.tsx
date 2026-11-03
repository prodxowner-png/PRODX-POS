import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../context/ShiftContext';
import { useSound } from '../../context/SoundContext';
import { createMoney, parseDecimalToCents } from '../../domain/money';
import { Store, Monitor, User as UserIcon, DollarSign, Loader2, CheckCircle2, Sparkles } from 'lucide-react';

interface StartShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StartShiftModal: React.FC<StartShiftModalProps> = ({ isOpen, onClose }) => {
  const { language } = useLanguage();
  const { session } = useAuth();
  const { openShift, isLoading: isShiftLoading } = useShift();
  const { playClick, playSuccess, playCriticalAlert } = useSound();
  const isThai = language === 'th';

  const [floatBahtOrUSD, setFloatBahtOrUSD] = useState<string>('100');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!session) return null;

  const currency = session.currentStore.currency || 'USD';
  const isTHB = currency.toUpperCase() === 'THB';

  const presets = isTHB
    ? [
        { label: '500 ฿', value: '500' },
        { label: '1,000 ฿', value: '1000' },
        { label: '2,000 ฿', value: '2000' },
        { label: '5,000 ฿', value: '5000' },
      ]
    : [
        { label: '$50', value: '50' },
        { label: '$100', value: '100' },
        { label: '$200', value: '200' },
        { label: '$500', value: '500' },
      ];

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    playClick();
    if (!/^\d+(\.\d{1,2})?$/.test(floatBahtOrUSD.trim())) {
      playCriticalAlert();
      return;
    }

    setIsSubmitting(true);
    try {
      const cents = parseDecimalToCents(floatBahtOrUSD);
      const money = createMoney(cents, currency);
      await openShift(money);
      playSuccess();
      onClose();
    } catch (err) {
      playCriticalAlert();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isThai ? 'เปิดกะการทำงาน (Start Shift)' : 'Start Shift & Cash Drawer'}
      description={
        isThai
          ? 'ตรวจพบการเข้าสู่ระบบใหม่ กรุณากำหนดเงินทอนเริ่มต้นในลิ้นชักก่อนเริ่มเปิดการขาย'
          : 'Welcome! Specify your initial register opening cash float to begin operations.'
      }
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Cashier & Station Summary Header */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-primary" />
              <span className="font-bold">{session.currentUser.name}</span>
              <span className="text-slate-400">({session.currentUser.role.toUpperCase()})</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
              {session.currentUser.employeeCode}
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-bold text-slate-700 pt-1 border-t border-slate-200/80">
            <div className="flex items-center gap-1 text-slate-600">
              <Store className="w-3.5 h-3.5 text-slate-400" />
              <span>{session.currentStore.name}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-600">
              <Monitor className="w-3.5 h-3.5 text-slate-400" />
              <span>Register: <strong className="text-slate-900">{session.registerId}</strong></span>
            </div>
          </div>
        </div>

        {/* Float Input Field */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase text-slate-700 flex items-center justify-between">
            <span>{isThai ? 'เงินทอนเริ่มต้น (Opening Float)' : 'Opening Float Amount'}</span>
            <span className="text-xs font-mono font-bold text-primary">{currency}</span>
          </label>

          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-black text-slate-400 text-base">
              {isTHB ? '฿' : '$'}
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={floatBahtOrUSD}
              onChange={(e) => setFloatBahtOrUSD(e.target.value)}
              className="w-full h-12 bg-white border-2 border-slate-200 rounded-xl pl-9 pr-4 text-xl font-mono font-black text-slate-900 outline-none focus:border-primary transition-all"
              placeholder="0.00"
            />
          </div>

          {/* Quick Preset Buttons */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.value}
                onClick={() => {
                  playClick();
                  setFloatBahtOrUSD(preset.value);
                }}
                className={`h-9 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  floatBahtOrUSD === preset.value
                    ? 'border-primary bg-primary/10 text-primary font-black shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form CTAs */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              playClick();
              onClose();
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 cursor-pointer"
          >
            {isThai ? 'ข้ามไว้ก่อน' : 'Skip For Now'}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isShiftLoading}
            className="px-5 py-2.5 rounded-xl bg-primary text-white font-black text-xs hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-primary/20 inline-flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{isThai ? 'กำลังเปิดกะ...' : 'Opening Shift...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{isThai ? 'ยืนยันเปิดกะขาย' : 'Start Shift'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
