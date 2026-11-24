import React from 'react';
import { Camera, KeyRound } from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

interface QrBadgeScannerPanelProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  onScan: (result: any) => void;
  onSwitchMode: (mode: 'pin' | 'biometric' | 'qr' | 'email') => void;
}

export const QrBadgeScannerPanel: React.FC<QrBadgeScannerPanelProps> = ({
  isThai,
  terminalReady,
  isLoading,
  onScan,
  onSwitchMode,
}) => {
  return (
    <div className="space-y-3 max-w-[320px] mx-auto text-center">
      <div className="relative rounded-2xl border-4 border-[#FFFFFF] dark:border-slate-700 bg-[#0F172A] overflow-hidden aspect-square max-w-[200px] mx-auto shadow-lg">
        {terminalReady ? (
          <Scanner
            onScan={onScan}
            onError={(e: any) => console.log(e?.message)}
            components={{ finder: true, torch: true }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4 text-xs text-slate-300">
            {isThai ? 'กรุณาเลือก Scope ก่อน' : 'Select Scope First'}
          </div>
        )}
      </div>

      <div>
        <div className="inline-flex items-center gap-1.5 text-[#183D32] dark:text-[#F8FAFC] font-black text-xs uppercase tracking-wider mb-0.5">
          <Camera className="w-4 h-4 text-[#F97316]" />
          <span>{isThai ? 'สแกนบัตรพนักงาน (QR)' : 'Scan Employee Badge'}</span>
        </div>
        <p className="text-[11px] text-[#5F6C65] dark:text-[#94A3B8] font-medium">
          {isThai ? 'วางบัตรพนักงานหน้ากล้องเพื่อยืนยันตัวตนทันที' : 'Place badge in front of camera.'}
        </p>
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => onSwitchMode('pin')}
          className="min-h-[40px] px-3 py-1.5 text-xs font-bold text-[#5F6C65] dark:text-[#CBD5E1] hover:text-[#183D32] dark:hover:text-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1.5"
        >
          <KeyRound className="w-4 h-4 text-[#F97316]" />
          <span>{isThai ? 'กลับไปใช้แป้น PIN' : 'Switch to PIN Pad'}</span>
        </button>
      </div>
    </div>
  );
};
