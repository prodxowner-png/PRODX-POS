import React from 'react';
import { LucideIcon } from 'lucide-react';

export type GraphicIconColor =
  | 'primary'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'purple'
  | 'cyan'
  | 'blue'
  | 'orange'
  | 'slate';

export type GraphicIconVariant = 'badge' | 'glow' | 'glass' | 'duotone' | 'outline' | 'flat';
export type GraphicIconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface GraphicIconProps {
  icon?: LucideIcon | React.ReactNode;
  name?: string;
  color?: GraphicIconColor;
  variant?: GraphicIconVariant;
  size?: GraphicIconSize;
  badgeText?: string;
  className?: string;
  animateHover?: boolean;
}

const COLOR_MAP: Record<
  GraphicIconColor,
  {
    bg: string;
    border: string;
    text: string;
    glow: string;
    gradient: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  primary: {
    bg: 'bg-primary/10 dark:bg-primary/20',
    border: 'border-primary/25 dark:border-primary/40',
    text: 'text-primary dark:text-primary-light',
    glow: 'shadow-[0_0_16px_rgba(20,184,166,0.25)]',
    gradient: 'bg-gradient-to-br from-primary/15 via-primary/5 to-transparent',
    badgeBg: 'bg-primary text-primary-foreground',
    badgeText: 'text-primary',
  },
  emerald: {
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    border: 'border-emerald-500/25 dark:border-emerald-500/40',
    text: 'text-emerald-600 dark:text-emerald-400',
    glow: 'shadow-[0_0_16px_rgba(16,185,129,0.25)]',
    gradient: 'bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent',
    badgeBg: 'bg-emerald-500 text-white',
    badgeText: 'text-emerald-500',
  },
  amber: {
    bg: 'bg-amber-500/10 dark:bg-amber-500/20',
    border: 'border-amber-500/25 dark:border-amber-500/40',
    text: 'text-amber-600 dark:text-amber-400',
    glow: 'shadow-[0_0_16px_rgba(245,158,11,0.25)]',
    gradient: 'bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent',
    badgeBg: 'bg-amber-500 text-white',
    badgeText: 'text-amber-500',
  },
  rose: {
    bg: 'bg-rose-500/10 dark:bg-rose-500/20',
    border: 'border-rose-500/25 dark:border-rose-500/40',
    text: 'text-rose-600 dark:text-rose-400',
    glow: 'shadow-[0_0_16px_rgba(244,63,94,0.25)]',
    gradient: 'bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent',
    badgeBg: 'bg-rose-500 text-white',
    badgeText: 'text-rose-500',
  },
  indigo: {
    bg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
    border: 'border-indigo-500/25 dark:border-indigo-500/40',
    text: 'text-indigo-600 dark:text-indigo-400',
    glow: 'shadow-[0_0_16px_rgba(99,102,241,0.25)]',
    gradient: 'bg-gradient-to-br from-indigo-500/15 via-indigo-500/5 to-transparent',
    badgeBg: 'bg-indigo-500 text-white',
    badgeText: 'text-indigo-500',
  },
  purple: {
    bg: 'bg-purple-500/10 dark:bg-purple-500/20',
    border: 'border-purple-500/25 dark:border-purple-500/40',
    text: 'text-purple-600 dark:text-purple-400',
    glow: 'shadow-[0_0_16px_rgba(168,85,247,0.25)]',
    gradient: 'bg-gradient-to-br from-purple-500/15 via-purple-500/5 to-transparent',
    badgeBg: 'bg-purple-500 text-white',
    badgeText: 'text-purple-500',
  },
  cyan: {
    bg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
    border: 'border-cyan-500/25 dark:border-cyan-500/40',
    text: 'text-cyan-600 dark:text-cyan-400',
    glow: 'shadow-[0_0_16px_rgba(6,182,212,0.25)]',
    gradient: 'bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent',
    badgeBg: 'bg-cyan-500 text-white',
    badgeText: 'text-cyan-500',
  },
  blue: {
    bg: 'bg-blue-500/10 dark:bg-blue-500/20',
    border: 'border-blue-500/25 dark:border-blue-500/40',
    text: 'text-blue-600 dark:text-blue-400',
    glow: 'shadow-[0_0_16px_rgba(59,130,246,0.25)]',
    gradient: 'bg-gradient-to-br from-blue-500/15 via-blue-500/5 to-transparent',
    badgeBg: 'bg-blue-500 text-white',
    badgeText: 'text-blue-500',
  },
  orange: {
    bg: 'bg-primary/10 dark:bg-primary/20',
    border: 'border-orange-500/25 dark:border-orange-500/40',
    text: 'text-primary dark:text-orange-400',
    glow: 'shadow-[0_0_16px_rgba(249,115,22,0.25)]',
    gradient: 'bg-gradient-to-br from-orange-500/15 via-orange-500/5 to-transparent',
    badgeBg: 'bg-primary text-primary-foreground',
    badgeText: 'text-primary',
  },
  slate: {
    bg: 'bg-slate-500/10 dark:bg-slate-500/20',
    border: 'border-slate-500/25 dark:border-slate-500/40',
    text: 'text-slate-600 dark:text-slate-300',
    glow: 'shadow-[0_0_16px_rgba(100,116,139,0.2)]',
    gradient: 'bg-gradient-to-br from-slate-500/15 via-slate-500/5 to-transparent',
    badgeBg: 'bg-slate-600 text-white',
    badgeText: 'text-slate-500',
  },
};

const SIZE_MAP: Record<
  GraphicIconSize,
  {
    container: string;
    icon: string;
    radius: string;
    badge: string;
  }
> = {
  xs: {
    container: 'w-6 h-6 min-w-6',
    icon: 'h-3.5 w-3.5',
    radius: 'rounded-md',
    badge: 'text-[8px] px-1 -top-1 -right-1',
  },
  sm: {
    container: 'w-8 h-8 min-w-8',
    icon: 'h-4 w-4',
    radius: 'rounded-lg',
    badge: 'text-[9px] px-1 -top-1 -right-1',
  },
  md: {
    container: 'w-10 h-10 min-w-10',
    icon: 'h-5 w-5',
    radius: 'rounded-xl',
    badge: 'text-[10px] px-1.5 -top-1.5 -right-1.5',
  },
  lg: {
    container: 'w-12 h-12 min-w-12',
    icon: 'h-6 w-6',
    radius: 'rounded-2xl',
    badge: 'text-[11px] px-1.5 -top-2 -right-2',
  },
  xl: {
    container: 'w-16 h-16 min-w-16',
    icon: 'h-8 w-8',
    radius: 'rounded-3xl',
    badge: 'text-xs px-2 -top-2 -right-2',
  },
};

export const GraphicIcon: React.FC<GraphicIconProps> = ({
  icon: IconProp,
  color = 'primary',
  variant = 'badge',
  size = 'md',
  badgeText,
  className = '',
  animateHover = true,
}) => {
  const c = COLOR_MAP[color] || COLOR_MAP.primary;
  const s = SIZE_MAP[size] || SIZE_MAP.md;

  const renderIcon = () => {
    if (!IconProp) return null;
    if (React.isValidElement(IconProp)) {
      return React.cloneElement(IconProp as React.ReactElement<{ className?: string }>, {
        className: `${s.icon} ${c.text} ${(IconProp.props as any).className || ''}`,
      });
    }
    const IconComponent = IconProp as LucideIcon;
    return <IconComponent className={`${s.icon} ${c.text}`} strokeWidth={2.2} />;
  };

  let variantStyles = '';
  switch (variant) {
    case 'badge':
      variantStyles = `${c.gradient} ${c.bg} border ${c.border} shadow-xs backdrop-blur-xs`;
      break;
    case 'glow':
      variantStyles = `${c.bg} border ${c.border} ${c.glow} backdrop-blur-sm`;
      break;
    case 'glass':
      variantStyles = `bg-card/70 dark:bg-card/50 border ${c.border} shadow-sm backdrop-blur-md`;
      break;
    case 'duotone':
      variantStyles = `${c.bg} border border-transparent`;
      break;
    case 'outline':
      variantStyles = `bg-transparent border ${c.border}`;
      break;
    case 'flat':
      variantStyles = `${c.bg}`;
      break;
  }

  const hoverStyles = animateHover
    ? 'transition-all duration-200 hover:scale-105 active:scale-95'
    : '';

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${s.container} ${s.radius} ${variantStyles} ${hoverStyles} ${className}`}
    >
      {renderIcon()}
      {badgeText && (
        <span
          className={`absolute ${s.badge} font-mono tabular-nums font-black uppercase rounded-full shadow-xs ${c.badgeBg}`}
        >
          {badgeText}
        </span>
      )}
    </div>
  );
};
