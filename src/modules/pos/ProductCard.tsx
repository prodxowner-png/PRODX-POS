import React from 'react';
import { Product } from '../../domain/catalog';
import { formatMoney } from '../../domain/money';
import { useLanguage } from '../../context/LanguageContext';
import { triggerHaptic } from '../../services/hapticService';
import { AlertCircle, Plus } from 'lucide-react';

export interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
  isFocused?: boolean;
  id?: string;
}

export const ProductCard = React.memo<ProductCardProps>(({ product, onAddToCart, isFocused = false, id }) => {
  const { t } = useLanguage();
  const isLowStock = product.currentStock <= product.reorderPoint;
  const isOutOfStock = product.currentStock <= 0;

  return (
    <div
      id={id}
      role="button"
      tabIndex={isOutOfStock ? -1 : 0}
      aria-disabled={isOutOfStock}
      aria-label={`${product.name}, ${formatMoney(product.price)}${isOutOfStock ? ` - ${t.pos.outOfStock}` : ''}`}
      onClick={() => {
        if (!isOutOfStock) {
          triggerHaptic('tap');
          onAddToCart(product);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!isOutOfStock) {
            triggerHaptic('tap');
            onAddToCart(product);
          }
        }
      }}
      className={`group relative min-h-[128px] theme-btn-radius border-crisp border p-3.5 sm:p-4 text-left transition-all duration-300 select-none flex flex-col justify-between shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-card ${
        isOutOfStock
          ? 'opacity-50 border-border bg-card/60 cursor-not-allowed'
          : isFocused
            ? 'ring-2 ring-primary border-primary bg-primary/10 cursor-pointer active-scale shadow-[0_0_20px_rgba(59,130,246,0.15)]'
            : 'border-border bg-card hover:border-primary/50 hover:bg-card/80 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] cursor-pointer active-scale'
      }`}
    >
      {/* Top Details */}
      <div>
        <div className="flex items-start justify-between gap-1.5 mb-1.5 sm:mb-2">
          <span className="text-mono-xs text-text/50 font-bold uppercase truncate">
            {product.sku}
          </span>

          {/* Stock indicator badge */}
          {isOutOfStock ? (
            <span className="text-label-xs px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 shrink-0">
              {t.pos.outOfStock}
            </span>
          ) : isLowStock ? (
            <span className="text-label-xs px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1 shrink-0">
              <AlertCircle className="h-3 w-3" />
              <span className="font-mono">{product.currentStock}</span>
            </span>
          ) : (
            <span className="text-label-xs font-medium text-text/50 shrink-0">
              <span className="font-mono">{product.currentStock}</span> {t.pos.inStock}
            </span>
          )}
        </div>

        <h3 className="text-heading-4 text-text line-clamp-2 leading-snug group-hover:text-primary transition-colors">
          {product.name}
        </h3>

        {product.description && (
          <p className="mt-1 text-caption-sm text-text/70 line-clamp-1 sm:line-clamp-2">
            {product.description}
          </p>
        )}
      </div>

      {/* Bottom Price & Add Action */}
      <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-2.5 border-t border-border border-crisp flex items-center justify-between gap-1">
        <div className="text-mono-md font-bold text-primary truncate">
          {formatMoney(product.price)}
        </div>

        <div className="min-h-[38px] min-w-[38px] h-9 w-9 theme-btn-radius bg-background border-crisp border border-border text-text/70 flex items-center justify-center group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-all shrink-0 shadow-2xs">
          <Plus className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
});
