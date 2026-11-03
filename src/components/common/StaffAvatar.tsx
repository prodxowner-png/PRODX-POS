import React, { useState } from 'react';

export interface StaffAvatarProps {
  name?: string;
  role?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  avatarUrl?: string;
  className?: string;
  showStatusIndicator?: boolean;
  isOnline?: boolean;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
};

const STATUS_SIZE_MAP = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
  xl: 'h-3.5 w-3.5',
};

export const StaffAvatar: React.FC<StaffAvatarProps> = ({
  name = 'Staff Member',
  size = 'md',
  avatarUrl = '/src/assets/images/staff_avatar_minimalist.svg',
  className = '',
  showStatusIndicator = false,
  isOnline = true,
}) => {
  const [imageError, setImageError] = useState(false);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ST';

  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${SIZE_MAP[size]} ${className}`}>
      {!imageError && avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className="w-full h-full rounded-xl object-cover border border-slate-200/80 dark:border-slate-800 shadow-xs"
        />
      ) : (
        <div className="w-full h-full rounded-xl bg-gradient-to-br from-[#1e293b] to-[#0f172a] text-[#ff6b1a] font-black flex items-center justify-center border border-slate-800 shadow-xs">
          {initials}
        </div>
      )}

      {showStatusIndicator && (
        <span className={`absolute -bottom-0.5 -right-0.5 flex ${STATUS_SIZE_MAP[size]}`}>
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isOnline ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span
            className={`relative inline-flex rounded-full ${STATUS_SIZE_MAP[size]} border border-white dark:border-slate-900 ${
              isOnline ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        </span>
      )}
    </div>
  );
};
