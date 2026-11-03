import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

export const DEFAULT_PRODX_LOGO_URL = '/prodx-pos-logo.svg';
export const DEFAULT_PRODX_RECEIPT_LOGO_URL = '/prodx-pos-receipt-logo.svg';

export type ProdxLogoVariant = 'full' | 'horizontal' | 'mark' | 'receipt';
export type ProdxLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ProdxLogoProps {
  variant?: ProdxLogoVariant;
  size?: ProdxLogoSize;
  className?: string;
  showTagline?: boolean;
  monochrome?: boolean;
}

/**
 * Crisp inline vector-style emblem for PRODX POS (used in app headers, LoginScreen, Admin Console, and sidebars)
 */
export const ProdxVectorMark: React.FC<{
  size?: number;
  monochrome?: boolean;
  className?: string;
}> = ({ size = 36, monochrome = false, className = '' }) => {
  const uniqueId = React.useId().replace(/:/g, '');
  const bgGradId = `prodxBg_${uniqueId}`;
  const accentGradId = `prodxAccent_${uniqueId}`;
  const blueGradId = `prodxBlue_${uniqueId}`;

  if (monochrome) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 select-none ${className}`}
        role="img"
        aria-label="PRODX POS Vector Mark"
      >
        <rect x="4" y="4" width="120" height="120" rx="26" fill="#000000" />
        <rect
          x="12"
          y="12"
          width="104"
          height="104"
          rx="19"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        <path
          d="M34 32 H64 C77.2548 32 88 41.8497 88 54 C88 66.1503 77.2548 76 64 76 H48 V96 H34 V32 Z"
          fill="#FFFFFF"
        />
        <path
          d="M48 45 V63 H63 C69.0751 63 74 58.9706 74 54 C74 49.0294 69.0751 45 63 45 H48 Z"
          fill="#000000"
        />
        <path d="M66 56 L96 96" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" />
        <path d="M96 32 L58 84" stroke="#000000" strokeWidth="17" strokeLinecap="round" />
        <path d="M96 32 L58 84" stroke="#FFFFFF" strokeWidth="11" strokeLinecap="round" />
        <circle cx="96" cy="96" r="6" fill="#FFFFFF" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      role="img"
      aria-label="PRODX POS Vector Logo"
    >
      <defs>
        <linearGradient id={bgGradId} x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="55%" stopColor="#090D16" />
          <stop offset="100%" stopColor="#050811" />
        </linearGradient>
        <linearGradient id={accentGradId} x1="28" y1="24" x2="104" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF7A2E" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient id={blueGradId} x1="64" y1="20" x2="108" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      <rect
        x="4"
        y="4"
        width="120"
        height="120"
        rx="28"
        fill={`url(#${bgGradId})`}
        stroke="#1E293B"
        strokeWidth="2.5"
      />
      <rect
        x="12"
        y="12"
        width="104"
        height="104"
        rx="21"
        stroke="#334155"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.45"
      />
      <path
        d="M40 12 L44 16 L48 12 L52 16 L56 12 L60 16 L64 12 L68 16 L72 12 L76 16 L80 12 L84 16 L88 12"
        stroke="#475569"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <path
        d="M66 56 L96 96"
        stroke={`url(#${blueGradId})`}
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M34 32 H64 C77.2548 32 88 41.8497 88 54 C88 66.1503 77.2548 76 64 76 H48 V96 H34 V32 Z"
        fill="#F8FAFC"
      />
      <path
        d="M48 45 V63 H63 C69.0751 63 74 58.9706 74 54 C74 49.0294 69.0751 45 63 45 H48 Z"
        fill="#090D16"
      />
      <path
        d="M96 32 L58 84"
        stroke={`url(#${accentGradId})`}
        strokeWidth="12"
        strokeLinecap="round"
      />
      <circle cx="96" cy="96" r="6" fill="#FF6B1A" />
      <circle cx="96" cy="96" r="2.5" fill="#FFF7ED" />
    </svg>
  );
};

/**
 * High-contrast monochrome vector logo lockup optimized for 58mm / 80mm thermal receipts and printed invoices
 */
export const ProdxReceiptLogo: React.FC<{
  customLogoUrl?: string | null;
  paperWidth?: '58mm' | '80mm';
  className?: string;
}> = ({ customLogoUrl, paperWidth = '80mm', className = '' }) => {
  const is58mm = paperWidth === '58mm';

  if (customLogoUrl && customLogoUrl !== DEFAULT_PRODX_LOGO_URL && customLogoUrl !== DEFAULT_PRODX_RECEIPT_LOGO_URL) {
    return (
      <div className={`flex flex-col items-center justify-center ${className}`}>
        <img
          src={customLogoUrl}
          alt="PRODX POS Store Receipt Logo"
          referrerPolicy="no-referrer"
          className={`${is58mm ? 'max-h-10 max-w-[110px]' : 'max-h-12 max-w-[140px]'} object-contain filter grayscale contrast-150`}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center select-none ${className}`}>
      <svg
        viewBox="0 0 320 96"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={is58mm ? 'h-10 w-auto max-w-[155px]' : 'h-12 w-auto max-w-[185px]'}
        role="img"
        aria-label="PRODX POS Official Thermal Receipt Logo"
      >
        <rect x="6" y="8" width="80" height="80" rx="16" fill="#000000" />
        <rect
          x="11"
          y="13"
          width="70"
          height="70"
          rx="12"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
        <path
          d="M26 26 H47 C56.3888 26 64 32.7157 64 41 C64 49.2843 56.3888 56 47 56 H36 V70 H26 V26 Z"
          fill="#FFFFFF"
        />
        <path
          d="M36 35 V47 H46.5 C50.6421 47 54 44.3137 54 41 C54 37.6863 50.6421 35 46.5 35 H36 Z"
          fill="#000000"
        />
        <path d="M51 46 L68 70" stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" />
        <path d="M68 26 L44 60" stroke="#000000" strokeWidth="11" strokeLinecap="round" />
        <path d="M68 26 L44 60" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" />
        <circle cx="68" cy="70" r="4" fill="#FFFFFF" />
        <text
          x="100"
          y="46"
          fill="#000000"
          fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          fontSize="32"
          fontWeight="900"
          letterSpacing="-1"
        >
          PRODX
        </text>
        <rect x="218" y="21" width="66" height="30" rx="6" fill="#000000" />
        <text
          x="251"
          y="42"
          fill="#FFFFFF"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize="20"
          fontWeight="900"
          textAnchor="middle"
          letterSpacing="1"
        >
          POS
        </text>
        <line x1="100" y1="58" x2="310" y2="58" stroke="#000000" strokeWidth="2" />
        <line
          x1="100"
          y1="62"
          x2="310"
          y2="62"
          stroke="#000000"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <text
          x="100"
          y="77"
          fill="#000000"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize="10.5"
          fontWeight="800"
          letterSpacing="2.2"
        >
          ENTERPRISE RETAIL TERMINAL
        </text>
      </svg>
    </div>
  );
};

export const ProdxLogo: React.FC<ProdxLogoProps> = ({
  variant = 'horizontal',
  size = 'md',
  className = '',
  showTagline = true,
  monochrome = false,
}) => {
  const { customLogo } = useTheme();
  const { session } = useAuth();

  const storeName = session?.currentStore?.name || 'PRODX POS';

  const sizeMap = {
    xs: { icon: 26, title: 'text-sm' },
    sm: { icon: 34, title: 'text-base' },
    md: { icon: 42, title: 'text-lg sm:text-xl' },
    lg: { icon: 56, title: 'text-2xl sm:text-3xl' },
    xl: { icon: 84, title: 'text-4xl sm:text-5xl' },
  };

  const currentSize = sizeMap[size];

  if (variant === 'receipt') {
    return <ProdxReceiptLogo customLogoUrl={customLogo} className={className} />;
  }

  const hasCustomUploadedLogo =
    Boolean(customLogo) &&
    customLogo !== DEFAULT_PRODX_LOGO_URL &&
    customLogo !== DEFAULT_PRODX_RECEIPT_LOGO_URL;

  const renderMark = (iconPx: number, extraClass = '') => {
    if (hasCustomUploadedLogo && customLogo) {
      return (
        <img
          src={customLogo}
          alt={storeName}
          referrerPolicy="no-referrer"
          className={`object-contain rounded-lg shrink-0 ${extraClass}`}
          style={{ width: iconPx, height: iconPx }}
        />
      );
    }
    return (
      <ProdxVectorMark
        size={iconPx}
        monochrome={monochrome}
        className={`transition-transform duration-200 hover:scale-105 ${extraClass}`}
      />
    );
  };

  if (variant === 'mark') {
    return renderMark(currentSize.icon, className);
  }

  if (variant === 'full') {
    const isLg = size === 'lg' || size === 'xl';
    const fullIconSize = isLg ? 96 : 72;
    return (
      <div className={`flex flex-col items-center text-center select-none ${className}`}>
        <div className="mb-2.5">{renderMark(fullIconSize, 'shadow-sm')}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-base sm:text-lg font-black tracking-tight text-text uppercase">
            PRODX
          </span>
          <span className="px-1.5 py-0.5 rounded bg-primary text-white font-mono text-xs font-black tracking-wider">
            POS
          </span>
        </div>
        {showTagline && (
          <div className="text-[10px] font-bold uppercase tracking-widest text-text/50 mt-0.5">
            {storeName}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {renderMark(currentSize.icon)}
      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-1.5 leading-none">
          <span
            className={`${currentSize.title} text-text uppercase font-black tracking-tight leading-tight whitespace-nowrap`}
          >
            PRODX
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25 font-mono text-[10px] font-black tracking-wider uppercase shrink-0">
            POS
          </span>
        </div>
        {showTagline && (
          <span className="text-[9px] font-sans text-text/55 font-bold tracking-wider uppercase truncate mt-0.5">
            {storeName !== 'PRODX POS' ? storeName : 'ENTERPRISE POS SYSTEM'}
          </span>
        )}
      </div>
    </div>
  );
};
