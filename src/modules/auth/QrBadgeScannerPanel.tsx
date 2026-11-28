import React from 'react';
import { Camera } from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

interface QrBadgeScannerPanelProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  onScan: (result: any) => void;
}

export const QrBadgeScannerPanel: React.FC<QrBadgeScannerPanelProps> = ({
  isThai,
  terminalReady,
  isLoading,
  onScan,
}) => {
  return (
    <div className="space-y-3 max-w-[320px] mx-auto text-center">
      <div
        className={`relative rounded-2xl border-4 border-brand-border-strong bg-brand-primary overflow-hidden aspect-square max-w-[200px] mx-auto shadow-lg ${
          isLoading ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        {terminalReady ? (
          <Scanner
            onScan={onScan}
            onError={(e: any) => console.log(e?.message)}
            components={{ finder: true, torch: true }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4 text-xs font-bold text-brand-primary-text/85">
            {isThai ? 'กรุณาเลือก Scope ก่อน' : 'Select Scope First'}
          </div>
        )}
      </div>

      <div>
        <div className="inline-flex items-center gap-1.5 text-brand-text-accent font-black text-xs uppercase tracking-wider mb-0.5">
          <Camera className="w-4 h-4 text-brand-text-accent" aria-hidden="true" />
          <span>{isThai ? 'สแกนบัตรพนักงาน (QR)' : 'Scan Employee Badge'}</span>
        </div>
        <p className="text-xs text-brand-text-secondary font-medium">
          {isThai ? 'วางบัตรพนักงานหน้ากล้องเพื่อยืนยันตัวตนทันที' : 'Place badge in front of camera.'}
        </p>
      </div>
    </div>
  );
};
