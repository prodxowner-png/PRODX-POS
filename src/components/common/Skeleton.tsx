import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: 'shimmer' | 'pulse';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'shimmer',
  ...props
}) => {
  const hasCustomBg = /\bbg-/.test(className);

  if (variant === 'pulse') {
    return (
      <div
        aria-hidden="true"
        className={`animate-pulse rounded-md ${
          hasCustomBg ? '' : 'bg-slate-200/80 dark:bg-slate-800/80'
        } ${className}`.trim()}
        {...props}
      />
    );
  }

  // Premium CSS Shimmer wave animation powered by PRODX Design System Tokens
  return (
    <div
      aria-hidden="true"
      className={`prodx-shimmer-skeleton ${
        hasCustomBg ? '' : ''
      } ${className}`.trim()}
      {...props}
    />
  );
};
