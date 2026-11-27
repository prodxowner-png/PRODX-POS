import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getZIndexClass } from '../../utils/ZIndexManager';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'right' | 'left';
  width?: string;
  id?: string;
  noPadding?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  closeLabel?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  width = 'w-full sm:max-w-md',
  id,
  noPadding = false,
  initialFocusRef,
  closeLabel = 'Close drawer',
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const generatedId = React.useId();
  const titleId = id ? `${id}-title` : `drawer-title-${generatedId}`;
  const descId = id ? `${id}-desc` : `drawer-desc-${generatedId}`;

  useFocusTrap(drawerRef, {
    isActive: isOpen,
    initialFocusRef,
    returnFocus: true,
    onEscape: onClose,
  });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (typeof document === 'undefined') return null;

  const isRight = side === 'right';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          id={id}
          className={`fixed inset-0 ${getZIndexClass('modal')} overflow-hidden flex ${
            isRight ? 'justify-end' : 'justify-start'
          }`}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer Slide-In Panel */}
          <motion.div
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            initial={{ x: isRight ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{
              x: isRight ? '100%' : '-100%',
              transition: { duration: 0.16, ease: 'easeIn' },
            }}
            transition={{
              type: 'spring',
              damping: 32,
              stiffness: 350,
              mass: 0.8,
            }}
            className={`relative z-10 ${width} bg-card border-crisp ${
              isRight ? 'border-l' : 'border-r'
            } border-border flex flex-col h-full shadow-2xl text-text outline-none`}
          >
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-crisp border-border shrink-0 bg-card">
              <div className="min-w-0 flex-1">
                <h3 id={titleId} className="text-heading-3 text-text">
                  {title}
                </h3>
                {description && (
                  <p id={descId} className="mt-0.5 text-caption text-text/70">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg text-text/70 hover:text-text hover:bg-background transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className={`flex-1 overflow-y-auto bg-card text-text ${noPadding ? '' : 'p-4 sm:p-6'}`}>
              {children}
            </div>

            {footer && (
              <div className="p-4 sm:p-5 border-t border-crisp border-border bg-card shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

