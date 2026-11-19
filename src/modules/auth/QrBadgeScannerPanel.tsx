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
      <div className="relative rounded-2xl border-4 border-slate-50 bg-slate-900 overflow-hidden aspect-square max-w-[200px] mx-auto shadow-lg">
        {terminalReady ? (
          <Scanner
            onScan={onScan}
            onError={(e: any) => console.log(e?.message)}
            components={{ finder: true, torch: true }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4 text-xs text-slate-400">
            {isThai ? 'กรุณาเลือก Scope ก่อน' : 'Select Scope First'}
          </div>
        )}
      </div>

      <div>
        <div className="inline-flex items-center gap-1.5 text-brand-primary font-black text-xs uppercase tracking-wider mb-0.5">
          <Camera className="w-4 h-4 text-brand-primary" />
          <span>{isThai ? 'สแกนบัตรพนักงาน (QR)' : 'Scan Employee Badge'}</span>
        </div>
        <p className="text-[11px] text-brand-text-secondary font-medium">
          {isThai ? 'วางบัตรพนักงานหน้ากล้องเพื่อยืนยันตัวตนทันที' : 'Place badge in front of camera.'}
        </p>
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => onSwitchMode('pin')}
          className="text-xs font-bold text-brand-text-secondary hover:text-brand-primary focus-visible:ring-2 focus-visible:ring-cta rounded-lg p-1 transition-colors cursor-pointer inline-flex items-center gap-1.5"
        >
          <KeyRound className="w-4 h-4 text-brand-primary" />
          <span>{isThai ? 'กลับไปใช้แป้น PIN' : 'Switch to PIN Pad'}</span>
        </button>
      </div>
    </div>
  );
};
