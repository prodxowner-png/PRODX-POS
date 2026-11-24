import React, { useEffect, useState } from 'react';
import { Save, RotateCcw, AlertCircle, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';

export interface StickyActionBarProps {
  isVisible: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  dirtyCount?: number;
  label?: string;
}

export const StickyActionBar: React.FC<StickyActionBarProps> = ({
  isVisible,
  isSaving,
  onSave,
  onDiscard,
  dirtyCount = 1,
  label,
}) => {
  const { language } = useLanguage();
  const [isMac, setIsMac] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    setIsMac(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent));
  }, []);

  if (!isVisible) return null;

  const saveShortcut = isMac ? '⌘S' : 'Ctrl+S';
  const discardShortcut = 'Esc';

  // If minimized: render an ultra-compact, non-intrusive floating pill
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-7 right-4 z-40 animate-in fade-in slide-in-from-bottom-3"
        role="status"
        aria-live="polite"
      >
        <div className="bg-card/95 backdrop-blur-md border border-primary/50 shadow-xl rounded-full px-3 py-1.5 flex items-center gap-2.5 text-text">
          <div className="w-2.5 h-2.5 rounded-full bg-cta" />
          <span className="text-xs font-bold text-text">
            {language === 'th' ? 'รอการบันทึก' : 'Unsaved'}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-mono font-bold tabular-nums">
            {dirtyCount}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSave}
            isLoading={isSaving}
            className="min-h-[36px] px-3 text-xs font-bold rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
            leftIcon={<Save className="h-3 w-3" />}
          >
            <span>{language === 'th' ? 'บันทึก' : 'Save'}</span>
          </Button>
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            title={language === 'th' ? 'ขยายแถบเครื่องมือ' : 'Expand action bar'}
            aria-label={language === 'th' ? 'ขยายแถบเครื่องมือ' : 'Expand action bar'}
            className="p-1.5 rounded-full text-text/60 hover:text-text hover:bg-background/80 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded mode: sleek, responsive, with minimize control
  return (
    <div
      className="fixed bottom-7 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-xl z-40 transition-all duration-300 transform translate-y-0 animate-in fade-in slide-in-from-bottom-4"
      role="status"
      aria-live="polite"
      aria-label={language === 'th' ? 'แถบแจ้งเตือนการแก้ไขที่ยังไม่ได้บันทึก' : 'Unsaved changes bar'}
    >
      <div className="bg-card/95 backdrop-blur-md border border-primary/40 shadow-2xl rounded-2xl p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-text">
        {/* Left Info & Status */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-brand-surface-selected text-brand-text-accent flex items-center justify-center shrink-0 border border-brand-border">
            <AlertCircle className="h-4 w-4 text-brand-text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-text flex items-center gap-1.5 flex-wrap">
              <span>{language === 'th' ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'Unsaved Changes'}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-mono font-bold tabular-nums">
                {dirtyCount} {language === 'th' ? 'รายการ' : 'fields'}
              </span>
            </div>
            <div className="text-[11px] text-brand-text-secondary truncate">
              {label || (language === 'th' ? 'กดบันทึกเพื่อนำการตั้งค่าไปใช้ทั้งระบบ' : 'Commit changes to apply across the terminal')}
            </div>
          </div>

          {/* Minimize toggle button */}
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            title={language === 'th' ? 'ย่อแถบเครื่องมือไม่ให้บังหน้าจอ' : 'Minimize to floating badge'}
            aria-label={language === 'th' ? 'ย่อแถบเครื่องมือ' : 'Minimize action bar'}
            className="p-1.5 rounded-lg text-text/60 hover:text-text hover:bg-background/80 transition cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
            className="text-xs min-h-[40px] px-2.5 sm:px-3 font-semibold rounded-xl border-border hover:bg-background/80 shrink-0"
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            <span className="whitespace-nowrap">{language === 'th' ? 'ยกเลิก' : 'Discard'}</span>
            <kbd className="hidden sm:inline-block ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-background/80 text-brand-text-secondary rounded border border-border">
              {discardShortcut}
            </kbd>
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSave}
            isLoading={isSaving}
            className="text-xs min-h-[40px] px-3 sm:px-4 font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20 shrink-0"
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            <span className="whitespace-nowrap">{language === 'th' ? 'บันทึก' : 'Save'}</span>
            <kbd className="hidden sm:inline-block ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white/20 text-primary-foreground rounded">
              {saveShortcut}
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  );
};
