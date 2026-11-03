import React from 'react';

export type SkeletonShape = 'rectangle' | 'circle' | 'text' | 'badge' | 'avatar' | 'card' | 'table-row';

export interface SkeletonLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Presets for shape or pre-configured layout blocks
   * @default 'rectangle'
   */
  shape?: SkeletonShape;
  /**
   * Custom width override (e.g. '100%', '200px', 'rem/em' or Tailwind class if passed via className)
   */
  width?: string | number;
  /**
   * Custom height override (e.g. '1rem', '40px', '200px')
   */
  height?: string | number;
  /**
   * Number of text lines to generate when shape is 'text'
   * @default 1
   */
  lines?: number;
  /**
   * Custom rounded corner radius style override
   */
  borderRadius?: string;
  /**
   * Additional Tailwind utility classes
   */
  className?: string;
}

/**
 * Reusable, high-performance SkeletonLoader component utilizing CSS-based shimmer animation
 * powered by PRODX Design System Tokens (`--prodx-shimmer-*` in `premium-design-system.css`).
 */
export const SkeletonLoader: React.FC<SkeletonLoaderProps> & {
  Text: React.FC<Omit<SkeletonLoaderProps, 'shape'>>;
  Avatar: React.FC<Omit<SkeletonLoaderProps, 'shape'>>;
  Badge: React.FC<Omit<SkeletonLoaderProps, 'shape'>>;
  Card: React.FC<Omit<SkeletonLoaderProps, 'shape'>>;
  TableRow: React.FC<{ columns?: number; className?: string }>;
} = ({
  shape = 'rectangle',
  width,
  height,
  lines = 1,
  borderRadius,
  className = '',
  style,
  ...props
}) => {
  const inlineStyles: React.CSSProperties = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(borderRadius !== undefined ? { borderRadius } : {}),
    ...style,
  };

  // Multiple text lines preset layout
  if (shape === 'text' && lines > 1) {
    return (
      <div className={`space-y-2.5 w-full ${className}`.trim()} role="status" aria-label="Loading...">
        {Array.from({ length: lines }).map((_, idx) => (
          <div
            key={idx}
            aria-hidden="true"
            style={
              idx === lines - 1 && !width
                ? { ...inlineStyles, width: '70%' }
                : inlineStyles
            }
            className="prodx-shimmer-skeleton h-4 w-full rounded-md"
          />
        ))}
      </div>
    );
  }

  // Pre-configured composite shape presets
  if (shape === 'avatar') {
    return (
      <div
        aria-hidden="true"
        style={inlineStyles}
        className={`prodx-shimmer-skeleton h-10 w-10 rounded-full shrink-0 ${className}`.trim()}
        {...props}
      />
    );
  }

  if (shape === 'badge') {
    return (
      <div
        aria-hidden="true"
        style={inlineStyles}
        className={`prodx-shimmer-skeleton h-6 w-20 rounded-full shrink-0 ${className}`.trim()}
        {...props}
      />
    );
  }

  if (shape === 'circle') {
    return (
      <div
        aria-hidden="true"
        style={inlineStyles}
        className={`prodx-shimmer-skeleton rounded-full shrink-0 ${className}`.trim()}
        {...props}
      />
    );
  }

  if (shape === 'card') {
    return (
      <div
        aria-hidden="true"
        style={inlineStyles}
        className={`prodx-shimmer-skeleton rounded-2xl border border-border/40 p-4 space-y-3.5 w-full ${className}`.trim()}
        {...props}
      >
        <div className="flex items-center justify-between">
          <SkeletonLoader shape="text" className="h-4 w-1/3" />
          <SkeletonLoader shape="avatar" className="h-8 w-8" />
        </div>
        <SkeletonLoader shape="text" className="h-8 w-1/2" />
        <SkeletonLoader shape="text" className="h-3.5 w-3/4" />
      </div>
    );
  }

  if (shape === 'table-row') {
    return (
      <div
        aria-hidden="true"
        style={inlineStyles}
        className={`p-4 grid grid-cols-12 gap-4 items-center w-full ${className}`.trim()}
        {...props}
      >
        <div className="col-span-1">
          <SkeletonLoader shape="circle" className="h-5 w-5" />
        </div>
        <div className="col-span-4 space-y-1.5">
          <SkeletonLoader shape="text" className="h-4 w-3/4" />
          <SkeletonLoader shape="text" className="h-3 w-1/2" />
        </div>
        <div className="col-span-3">
          <SkeletonLoader shape="badge" className="h-6 w-24" />
        </div>
        <div className="col-span-2">
          <SkeletonLoader shape="text" className="h-4 w-20" />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <SkeletonLoader shape="rectangle" className="h-8 w-8 rounded-lg" />
          <SkeletonLoader shape="rectangle" className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    );
  }

  // Base Single Block (Rectangle or single line text)
  return (
    <div
      aria-hidden="true"
      style={inlineStyles}
      className={`prodx-shimmer-skeleton ${
        shape === 'text' ? 'h-4 w-full rounded-md' : 'rounded-md'
      } ${className}`.trim()}
      {...props}
    />
  );
};

// Convenient sub-components for clean JSX composition
SkeletonLoader.Text = (props) => <SkeletonLoader shape="text" {...props} />;
SkeletonLoader.Avatar = (props) => <SkeletonLoader shape="avatar" {...props} />;
SkeletonLoader.Badge = (props) => <SkeletonLoader shape="badge" {...props} />;
SkeletonLoader.Card = (props) => <SkeletonLoader shape="card" {...props} />;
SkeletonLoader.TableRow = ({ columns = 12, className = '' }) => (
  <SkeletonLoader shape="table-row" className={className} />
);
