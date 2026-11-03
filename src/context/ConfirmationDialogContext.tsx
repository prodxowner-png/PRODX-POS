import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { AlertTriangle, Trash2, AlertOctagon, ShieldAlert, Check, X, Loader2 } from 'lucide-react';
import { useLanguage } from './LanguageContext';
import { Button } from '../components/common/Button';

export interface ConfirmationOptions {
  title: string;
  message: string | ReactNode;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  icon?: 'trash' | 'warning' | 'alert' | 'shield';
  /**
   * If provided, requires the user to type this exact text into a confirmation input
   * before the confirm button becomes enabled (e.g. typing the entity name or 'DELETE').
   */
  requireMatchText?: string;
  matchPrompt?: string;
  /**
   * Additional impact summary bullet points or affected counts
   */
  impactDetails?: {
    label: string;
    value: string | number;
    danger?: boolean;
  }[];
}

interface ConfirmationContextValue {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
  close: () => void;
  isOpen: boolean;
}

const ConfirmationDialogContext = createContext<ConfirmationContextValue | null>(null);

export const ConfirmationDialogProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { language } = useLanguage();
  const isThai = language === 'th';

  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: ConfirmationOptions | null;
  }>({
    isOpen: false,
    options: null,
  });

  const [userInputMatch, setUserInputMatch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Store promise resolver
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmationOptions): Promise<boolean> => {
    setUserInputMatch('');
    setIsSubmitting(false);
    setDialogState({
      isOpen: true,
      options,
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleResolve = (result: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
    setDialogState({
      isOpen: false,
      options: null,
    });
    setUserInputMatch('');
    setIsSubmitting(false);
  };

  const handleConfirm = () => {
    setIsSubmitting(true);
    handleResolve(true);
  };

  const handleCancel = () => {
    handleResolve(false);
  };

  const options = dialogState.options;
  const isDanger = !options?.variant || options.variant === 'danger';
  const isWarning = options?.variant === 'warning';

  const isMatchValid = !options?.requireMatchText || userInputMatch.trim() === options.requireMatchText.trim();

  const renderIcon = () => {
    const iconType = options?.icon || (isDanger ? 'trash' : 'warning');
    switch (iconType) {
      case 'trash':
        return <Trash2 className="h-6 w-6 text-rose-600" />;
      case 'alert':
        return <AlertOctagon className="h-6 w-6 text-rose-600" />;
      case 'shield':
        return <ShieldAlert className="h-6 w-6 text-purple-600" />;
      case 'warning':
      default:
        return <AlertTriangle className="h-6 w-6 text-amber-600" />;
    }
  };

  return (
    <ConfirmationDialogContext.Provider
      value={{
        confirm,
        close: handleCancel,
        isOpen: dialogState.isOpen,
      }}
    >
      {children}

      {/* Global Confirmation Modal */}
      {dialogState.isOpen && options && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) {
              handleCancel();
            }
          }}
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-150 overflow-hidden">
            {/* Header with Danger/Warning Graphic */}
            <div className="flex items-start gap-4">
              <div
                className={`h-12 w-12 rounded-2xl shrink-0 flex items-center justify-center ${
                  isDanger
                    ? 'bg-rose-100 ring-8 ring-rose-50'
                    : isWarning
                    ? 'bg-amber-100 ring-8 ring-amber-50'
                    : 'bg-purple-100 ring-8 ring-purple-50'
                }`}
              >
                {renderIcon()}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-black text-slate-900 leading-tight">
                    {options.title}
                  </h3>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isSubmitting}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors disabled:opacity-50"
                    aria-label="Close dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {options.description && (
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    {options.description}
                  </p>
                )}
              </div>
            </div>

            {/* Message Body */}
            <div className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
              <div className="font-semibold text-slate-800">{options.message}</div>

              {/* Impact Breakdown Pill Details */}
              {options.impactDetails && options.impactDetails.length > 0 && (
                <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                  <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    {isThai ? 'ข้อมูลที่จะได้รับผลกระทบ:' : 'Affected System Entities:'}
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {options.impactDetails.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          item.danger
                            ? 'bg-rose-50 text-rose-800 border border-rose-100'
                            : 'bg-white text-slate-700 border border-slate-200'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="font-mono font-black">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Explicit Confirmation Input Guard (for High-Risk Destructive Actions) */}
            {options.requireMatchText && (
              <div className="space-y-1.5 pt-1">
                <label className="block text-[11px] font-black uppercase tracking-wider text-rose-700">
                  {options.matchPrompt ||
                    (isThai
                      ? `กรุณาพิมพ์ "${options.requireMatchText}" เพื่อยืนยันการลบถาวร:`
                      : `Please type "${options.requireMatchText}" to confirm irreversible deletion:`)}
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder={options.requireMatchText}
                  value={userInputMatch}
                  onChange={(e) => setUserInputMatch(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-white border-2 border-rose-300 focus:border-rose-600 rounded-xl outline-hidden text-rose-950 placeholder:text-slate-300"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="font-bold text-xs"
              >
                {options.cancelText || (isThai ? 'ยกเลิก' : 'Cancel')}
              </Button>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isMatchValid || isSubmitting}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isDanger
                    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                    : isWarning
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20'
                    : 'bg-primary hover:bg-primary/90 text-white'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{isThai ? 'กำลังดำเนินการ...' : 'Processing...'}</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{options.confirmText || (isThai ? 'ยืนยันการลบ' : 'Confirm Deletion')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmationDialogContext.Provider>
  );
};

export const useConfirmation = (): ConfirmationContextValue => {
  const context = useContext(ConfirmationDialogContext);
  if (!context) {
    throw new Error('useConfirmation must be used within a ConfirmationDialogProvider');
  }
  return context;
};
