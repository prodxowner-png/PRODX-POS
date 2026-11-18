import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary hover:bg-primary-dark text-brand-primary-text font-semibold shadow-xs hover:shadow-sm ring-1 ring-primary/20',
  secondary:
    'bg-card text-text hover:bg-background font-semibold border border-border border-crisp shadow-2xs hover:border-text/20',
  outline:
    'bg-transparent text-text hover:bg-background border border-border border-crisp font-semibold hover:border-primary/50',
  ghost:
    'bg-transparent text-text/70 hover:text-text hover:bg-background/80 font-semibold',
  danger:
    'bg-danger hover:brightness-110 text-brand-primary-text font-semibold shadow-xs ring-1 ring-danger/20',
  success:
    'bg-success hover:brightness-110 text-brand-primary-text font-semibold shadow-xs ring-1 ring-success/20',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-[44px] min-h-[44px] px-3 text-xs font-semibold gap-1.5 theme-btn-radius',
  md: 'h-[44px] min-h-[44px] px-3.5 sm:px-4 text-xs sm:text-sm font-semibold gap-2 theme-btn-radius',
  lg: 'h-[48px] min-h-[48px] px-5 sm:px-6 text-sm sm:text-base font-bold gap-2.5 theme-btn-radius',
  icon: 'h-[44px] w-[44px] min-h-[44px] min-w-[44px] p-0 items-center justify-center theme-btn-radius',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center transition-all duration-150 ease-out active-scale select-none whitespace-nowrap focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100 cursor-pointer ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
