import { useEffect, useRef } from 'react';

export interface UseFocusTrapOptions {
  isActive: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  returnFocus?: boolean;
  onEscape?: () => void;
  preventScroll?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"])',
  'select:not([disabled]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([aria-hidden="true"])',
  'button:not([disabled]):not([aria-hidden="true"])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

export type FocusTrapDecision<T> =
  | { type: 'escape' }
  | { type: 'focus-container' }
  | { type: 'focus-target'; target: T }
  | { type: 'allow' };

export function resolveFocusTrapKeyDown<T>(params: {
  key: string;
  shiftKey: boolean;
  hasOnEscape: boolean;
  focusable: readonly T[];
  activeElement: T | null;
  activeInsideContainer: boolean;
}): FocusTrapDecision<T> {
  const { key, shiftKey, hasOnEscape, focusable, activeElement, activeInsideContainer } = params;

  if (key === 'Escape' && hasOnEscape) {
    return { type: 'escape' };
  }

  if (key !== 'Tab') {
    return { type: 'allow' };
  }

  if (focusable.length === 0) {
    return { type: 'focus-container' };
  }

  const firstElement = focusable[0];
  const lastElement = focusable[focusable.length - 1];

  if (shiftKey) {
    if (activeElement === firstElement || !activeInsideContainer) {
      return { type: 'focus-target', target: lastElement };
    }
  } else if (activeElement === lastElement || !activeInsideContainer) {
    return { type: 'focus-target', target: firstElement };
  }

  return { type: 'allow' };
}

export interface FocusTrapStack<T = symbol> {
  push(id: T): void;
  remove(id: T): void;
  isTopmost(id: T): boolean;
  size(): number;
}

export function createFocusTrapStack<T = symbol>(): FocusTrapStack<T> {
  const stack: T[] = [];
  return {
    push(id: T): void {
      const existingIndex = stack.indexOf(id);
      if (existingIndex !== -1) {
        stack.splice(existingIndex, 1);
      }
      stack.push(id);
    },
    remove(id: T): void {
      const index = stack.indexOf(id);
      if (index !== -1) {
        stack.splice(index, 1);
      }
    },
    isTopmost(id: T): boolean {
      return stack.length > 0 && stack[stack.length - 1] === id;
    },
    size(): number {
      return stack.length;
    },
  };
}

const activeFocusTrapStack = createFocusTrapStack<symbol>();

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions
) {
  const { isActive, initialFocusRef, returnFocus = true, onEscape, preventScroll = false } = options;
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const trapId = Symbol('focus-trap');
    activeFocusTrapStack.push(trapId);

    // Save the element that had focus before trapping
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;

    const getFocusableElements = (): HTMLElement[] => {
      if (!container) return [];
      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => {
        return (
          el.offsetParent !== null && // visible check
          !el.hasAttribute('disabled') &&
          el.getAttribute('aria-hidden') !== 'true' &&
          window.getComputedStyle(el).visibility !== 'hidden' &&
          window.getComputedStyle(el).display !== 'none'
        );
      });
      return elements;
    };

    // Initial focus placement
    const focusTimer = setTimeout(() => {
      if (!activeFocusTrapStack.isTopmost(trapId)) return;
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus({ preventScroll });
      } else {
        const focusable = getFocusableElements();
        if (focusable.length > 0) {
          focusable[0].focus({ preventScroll });
        } else {
          container.focus({ preventScroll });
        }
      }
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeFocusTrapStack.isTopmost(trapId)) {
        return;
      }

      const focusable = e.key === 'Tab' ? getFocusableElements() : [];
      const currentActive = document.activeElement as HTMLElement | null;
      const decision = resolveFocusTrapKeyDown({
        key: e.key,
        shiftKey: e.shiftKey,
        hasOnEscape: Boolean(onEscapeRef.current),
        focusable,
        activeElement: currentActive,
        activeInsideContainer: Boolean(currentActive && container.contains(currentActive)),
      });

      if (decision.type === 'escape' && onEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onEscapeRef.current();
        return;
      }

      if (decision.type === 'focus-container') {
        e.preventDefault();
        container.focus();
        return;
      }

      if (decision.type === 'focus-target') {
        e.preventDefault();
        decision.target.focus({ preventScroll });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      activeFocusTrapStack.remove(trapId);
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown, true);

      // Restore previously focused element
      if (returnFocus && previousActiveElementRef.current) {
        try {
          previousActiveElementRef.current.focus({ preventScroll });
        } catch (err) {
          // ignore if unmounted
        }
      }
    };
  }, [isActive, containerRef, initialFocusRef, returnFocus, preventScroll]);
}
