import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Monitor, Smartphone, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const { language } = useLanguage();

  // If already running as an installed PWA standalone app, do not render
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-xs font-bold shadow-md hover:bg-primary-dark transition active:scale-95 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{language === 'th' ? 'ติดตั้งแอป POS บนเครื่อง' : 'Install POS App'}</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-2 rounded-xl border border-border border-crisp px-4 py-2 text-xs font-bold text-zinc-700 dark:text-text/70 hover:bg-background/50 dark:hover:bg-white/5 transition active:scale-95 cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-primary" />
          <span>{language === 'th' ? 'ติดตั้งบน iOS' : 'Install on iOS'}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl border border-border border-crisp animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-text flex items-center gap-2 tracking-tight">
                  <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  {language === 'th' ? 'ติดตั้ง PRODX POS บน iPhone / iPad' : 'Install on iPhone / iPad'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-md hover:bg-background text-brand-text-secondary hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-text/70 leading-relaxed space-y-2">
                {language === 'th' ? (
                  <>
                    <p>1. แตะปุ่ม <strong>แชร์ (Share)</strong> <span className="inline-block px-1.5 py-0.5 bg-background rounded text-text font-mono tabular-nums">⎋</span> ที่แถบเครื่องมือ Safari</p>
                    <p>2. เลื่อนลงด้านล่างแล้วเลือก <strong>เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)</strong></p>
                    <p>3. แตะ <strong>เพิ่ม (Add)</strong> มุมขวาบนเพื่อยืนยันการติดตั้ง</p>
                  </>
                ) : (
                  <>
                    <p>1. Tap the <strong>Share</strong> button <span className="inline-block px-1.5 py-0.5 bg-background rounded text-text font-mono tabular-nums">⎋</span> in the Safari toolbar.</p>
                    <p>2. Scroll down and tap <strong>Add to Home Screen</strong>.</p>
                    <p>3. Tap <strong>Add</strong> in the top-right corner to install.</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full h-11 min-h-[44px] rounded-lg bg-slate-100 hover:bg-background dark:bg-slate-800 dark:hover:bg-slate-700/80 py-2.5 text-xs font-semibold text-text transition-colors cursor-pointer"
              >
                {language === 'th' ? 'ปิดหน้านี้' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
