import React from 'react';
import { Keyboard } from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { useLanguage } from '../../../context/LanguageContext';
import { useSettings } from '../../../context/SettingsContext';
import { useSound } from '../../../context/SoundContext';

export const KeyboardFocusToggle: React.FC = () => {
  const { language } = useLanguage();
  const { config, updateConfig } = useSettings();
  const { soundEnabled, playClick } = useSound();

  const isEnabled = config.hardware?.keyboardFocusCapture !== false;

  const handleToggle = () => {
    updateConfig({ hardware: { ...config.hardware, keyboardFocusCapture: !isEnabled } });
    if (soundEnabled) playClick();
  };

  return (
    <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
      <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-brand-surface-selected text-brand-text-accent shrink-0">
            <Keyboard className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">
              {language === 'th' ? 'การป้อนข้อมูลและแป้นพิมพ์ (Input Devices)' : 'Input Devices & Keyboard'}
            </h3>
            <p className="text-[11px] text-brand-text-secondary">
              {language === 'th' ? 'ตั้งค่าการทำงานร่วมกับแป้นพิมพ์ภายนอกและตัวสแกน' : 'Configure keyboard interaction and hardware wedge support.'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardBody className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="pr-4 min-w-0">
            <h4 className="text-sm font-bold text-text">
              {language === 'th' ? 'จับโฟกัสแป้นพิมพ์ (Keyboard Focus Capture)' : 'Keyboard Focus Capture'}
            </h4>
            <p className="text-xs text-text/60 mt-0.5 leading-relaxed">
              {language === 'th'
                ? 'เปิดให้ระบบคอยจับคำสั่งจากลูกศรและปุ่ม Enter เพื่อเลื่อนเลือกสินค้าในหน้า POS อัตโนมัติ ปิดเมื่อใช้แป้นพิมพ์ร่วมกับระบบอื่นแล้วเกิดการชนกัน'
                : 'Automatically captures Arrow keys and Enter to navigate the POS product grid. Disable this if it conflicts with external specialized hardware input.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-background ${
              isEnabled ? 'bg-primary' : 'bg-border'
            }`}
          >
            <span className="sr-only">Toggle Keyboard Focus Capture</span>
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </CardBody>
    </Card>
  );
};
