import React from 'react';

interface PosTerminalIllustrationProps {
  className?: string;
  isThai?: boolean;
}

/**
 * Retail Store Checkout Illustration
 * Exact faithful vector rendering of the retail minimart counter scene
 * from PRODX-POS reference design (Desktop view):
 * - Wooden retail checkout counter with warm natural wood tones
 * - Dual-screen modern POS terminal with orange analytics graph
 * - Emerging receipt from thermal printer
 * - Barcode scanner on cradle
 * - Indoor green potted plant in ceramic pot
 * - Minimart shelves with products in soft warm lighting
 */
export const PosTerminalIllustration: React.FC<PosTerminalIllustrationProps> = ({
  className = '',
  isThai = true,
}) => {
  return (
    <div className={`relative w-full h-full flex flex-col justify-between select-none ${className}`}>
      {/* Brand & Headline */}
      <div className="space-y-4 max-w-lg z-10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#F97316] text-white flex items-center justify-center font-black text-2xl shadow-md shadow-orange-500/20">
            P
          </div>
          <div>
            <div className="text-xl font-black text-[#183D32] tracking-tight">
              PRODX <span className="text-[#F97316]">POS</span>
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#64748B]">
              - PROFESSIONAL POS SYSTEM -
            </div>
          </div>
        </div>

        <h1 className="text-3xl xl:text-4xl 2xl:text-5xl font-black text-[#183D32] tracking-tight leading-[1.15]">
          Smart POS for <br />
          <span className="text-[#F97316]">Minimart & Retail</span>
        </h1>

        <p className="text-xs sm:text-sm text-[#475569] leading-relaxed max-w-md">
          {isThai
            ? 'ระบบจุดชำระเงินอัจฉริยะสำหรับร้านค้าปลีกและมินิมาร์ท รองรับขายออฟไลน์ สแกนบาร์โค้ด และจัดการกะพนักงานสมบูรณ์แบบ'
            : 'Next-generation intelligent point-of-sale for retail shops and minimarts with offline sync, rapid barcode scanning, and shift audit trail.'}
        </p>
      </div>

      {/* Vector Retail Minimart Counter Illustration */}
      <div className="relative w-full max-w-lg mx-auto aspect-[16/11] mt-auto">
        <svg
          viewBox="0 0 600 420"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-xl"
          aria-hidden="true"
        >
          <defs>
            {/* Ambient Background Warm Glow */}
            <radialGradient id="store-warm-glow" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#FFF7ED" stopOpacity="0.8" />
              <stop offset="60%" stopColor="#FED7AA" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#FED7AA" stopOpacity="0" />
            </radialGradient>

            {/* Wood Counter Top Linear Gradient */}
            <linearGradient id="counter-top" x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E2C19D" />
              <stop offset="50%" stopColor="#D4A77D" />
              <stop offset="100%" stopColor="#C69567" />
            </linearGradient>

            {/* Wood Counter Front Gradient */}
            <linearGradient id="counter-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B58153" />
              <stop offset="100%" stopColor="#8A582F" />
            </linearGradient>

            {/* Terminal Screen Gradient */}
            <linearGradient id="terminal-screen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1E293B" />
              <stop offset="100%" stopColor="#0F172A" />
            </linearGradient>

            {/* Plant Leaf Gradient */}
            <linearGradient id="plant-leaf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2F6F58" />
              <stop offset="100%" stopColor="#183D32" />
            </linearGradient>
          </defs>

          {/* Ambient Glow */}
          <rect x="0" y="0" width="600" height="420" fill="url(#store-warm-glow)" rx="24" />

          {/* Background Shelves with Minimart Products */}
          <g opacity="0.45">
            <rect x="60" y="40" width="480" height="12" rx="4" fill="#CBD5E1" />
            <rect x="60" y="110" width="480" height="12" rx="4" fill="#CBD5E1" />

            {/* Shelf 1 Items */}
            <rect x="90" y="16" width="22" height="24" rx="3" fill="#F97316" />
            <rect x="118" y="12" width="26" height="28" rx="3" fill="#183D32" />
            <rect x="150" y="18" width="20" height="22" rx="3" fill="#EA580C" />
            <rect x="220" y="14" width="36" height="26" rx="4" fill="#3B82F6" />
            <rect x="262" y="14" width="34" height="26" rx="4" fill="#E2E8F0" />
            <rect x="360" y="16" width="24" height="24" rx="3" fill="#10B981" />
            <rect x="390" y="10" width="28" height="30" rx="3" fill="#F59E0B" />
            <rect x="424" y="14" width="32" height="26" rx="3" fill="#183D32" />

            {/* Shelf 2 Items */}
            <rect x="80" y="78" width="40" height="32" rx="4" fill="#64748B" />
            <rect x="126" y="82" width="28" height="28" rx="3" fill="#F97316" />
            <rect x="160" y="76" width="32" height="34" rx="3" fill="#183D32" />
            <rect x="330" y="80" width="30" height="30" rx="3" fill="#F43F5E" />
            <rect x="366" y="78" width="34" height="32" rx="3" fill="#F59E0B" />
            <rect x="406" y="82" width="26" height="28" rx="3" fill="#0EA5E9" />
          </g>

          {/* Checkout Counter Platform */}
          <rect x="40" y="270" width="520" height="30" rx="6" fill="url(#counter-top)" />
          <rect x="50" y="300" width="500" height="90" rx="4" fill="url(#counter-front)" />
          {/* Subtle wood slats */}
          <line x1="150" y1="300" x2="150" y2="390" stroke="#78350F" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="250" y1="300" x2="250" y2="390" stroke="#78350F" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="350" y1="300" x2="350" y2="390" stroke="#78350F" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="450" y1="300" x2="450" y2="390" stroke="#78350F" strokeWidth="1" strokeOpacity="0.3" />

          {/* Indoor Potted Plant on Left of Counter */}
          <g>
            {/* Ceramic Pot */}
            <path d="M90 270 L130 270 L122 215 L98 215 Z" fill="#FFF7ED" stroke="#E2E8F0" strokeWidth="2" />
            <ellipse cx="110" cy="215" rx="12" ry="4" fill="#78350F" />
            {/* Plant Leaves */}
            <path d="M110 215 Q80 180 85 145 Q105 175 110 215 Z" fill="url(#plant-leaf)" />
            <path d="M110 215 Q135 170 145 140 Q130 180 110 215 Z" fill="#245A47" />
            <path d="M110 215 Q115 160 110 125 Q125 165 110 215 Z" fill="#2F6F58" />
            <path d="M110 215 Q70 200 60 175 Q90 195 110 215 Z" fill="#183D32" />
            <path d="M110 215 Q145 195 160 180 Q135 205 110 215 Z" fill="#183D32" />
          </g>

          {/* Dual-Screen POS Terminal (Center-Right) */}
          <g>
            {/* Terminal Base & Stand */}
            <path d="M260 270 L340 270 L330 230 L270 230 Z" fill="#334155" />
            <rect x="285" y="195" width="30" height="40" rx="3" fill="#1E293B" />

            {/* Main Screen Body (Tilted Bezel) */}
            <rect x="220" y="130" width="160" height="105" rx="10" fill="#0F172A" stroke="#334155" strokeWidth="3" />
            {/* Screen Inner Display */}
            <rect x="228" y="138" width="144" height="89" rx="6" fill="url(#terminal-screen)" />

            {/* Screen Content: POS Dashboard & Sales Analytics */}
            <rect x="236" y="146" width="36" height="6" rx="2" fill="#F97316" />
            <circle cx="360" cy="149" r="3" fill="#10B981" />

            {/* Sales Chart on Terminal Screen */}
            <path d="M236 195 L255 185 L275 188 L295 170 L315 176 L335 158 L355 162" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" />
            {/* Chart Area Fill */}
            <path d="M236 195 L255 185 L275 188 L295 170 L315 176 L335 158 L355 162 L355 205 L236 205 Z" fill="#F97316" fillOpacity="0.18" />

            {/* Secondary Customer Display (Back-facing angle) */}
            <rect x="365" y="150" width="22" height="65" rx="4" fill="#1E293B" stroke="#475569" strokeWidth="1.5" />
          </g>

          {/* Barcode Scanner on Stand */}
          <g>
            <rect x="405" y="245" width="24" height="25" rx="4" fill="#334155" />
            {/* Scanner Gun */}
            <path d="M400 240 L425 210 L435 218 L415 250 Z" fill="#0F172A" />
            {/* Scanner Red Light Indicator */}
            <ellipse cx="430" cy="214" rx="4" ry="2" fill="#EF4444" />
          </g>

          {/* Thermal Receipt Printer with Paper Receipt */}
          <g>
            {/* Printer Body */}
            <rect x="170" y="225" width="55" height="45" rx="6" fill="#1E293B" stroke="#334155" strokeWidth="2" />
            {/* Printer Slit */}
            <rect x="180" y="228" width="35" height="3" rx="1" fill="#0F172A" />
            {/* Status Lights */}
            <circle cx="178" cy="242" r="2" fill="#10B981" />
            <circle cx="178" cy="250" r="2" fill="#3B82F6" />

            {/* White Paper Receipt Emerging */}
            <path d="M182 228 L182 185 L187 188 L192 185 L197 188 L202 185 L207 188 L212 185 L212 228 Z" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1" />
            {/* Receipt Lines */}
            <line x1="186" y1="195" x2="208" y2="195" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="2 1" />
            <line x1="186" y1="202" x2="205" y2="202" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="3 1" />
            <line x1="186" y1="209" x2="208" y2="209" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="2 1" />
            <line x1="186" y1="216" x2="200" y2="216" stroke="#F97316" strokeWidth="1.5" />
          </g>
        </svg>
      </div>

      {/* Footer System Invariant Note */}
      <div className="z-10 text-[10px] text-[#64748B] font-bold tracking-wider uppercase pt-4 border-t border-[#E2E8F0]/70 flex items-center justify-between">
        <span>PRODX POS Enterprise Engine</span>
        <span>Version 2.5</span>
      </div>
    </div>
  );
};
