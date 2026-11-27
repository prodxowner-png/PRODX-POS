import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  RefreshCw,
  Boxes,
  AlertTriangle,
  TrendingDown,
  CheckCircle2,
  Copy,
  Check,
  Package,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { Product, Category } from '../../domain/catalog';
import { aiService } from '../../services/aiService';

interface InventoryAiOptimizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  categories: readonly Category[];
}

export const InventoryAiOptimizationModal: React.FC<InventoryAiOptimizationModalProps> = ({
  isOpen,
  onClose,
  products,
  categories,
}) => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';

  const [aiReport, setAiReport] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const lowStockThreshold = 10;
  const lowStockItems = products.filter((p) => p.currentStock <= lowStockThreshold && p.currentStock > 0);
  const outOfStockItems = products.filter((p) => p.currentStock <= 0);

  const handleRunOptimization = async () => {
    setIsLoading(true);
    try {
      const lowStockSummary = [...outOfStockItems, ...lowStockItems].map((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        return {
          name: p.name || 'Product',
          stock: p.currentStock,
          minStock: lowStockThreshold,
          category: cat?.name || 'ทั่วไป',
        };
      });

      const result = await aiService.optimizeInventory({
        lowStockProducts: lowStockSummary,
        totalProductsCount: products.length,
        outOfStockCount: outOfStockItems.length,
      });

      setAiReport(result);
    } catch (err: any) {
      addToast({
        title: isThai ? 'ไม่สามารถวิเคราะห์สต็อกได้' : 'Stock Analysis Failed',
        message: err.message || 'Error occurred while contacting PRODX AI service',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!aiReport) return;
    navigator.clipboard.writeText(aiReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    addToast({
      title: isThai ? 'คัดลอกเรียบร้อย' : 'Copied',
      message: isThai ? 'คัดลอกแผนเติมสต็อกลงคลิปบอร์ดแล้ว' : 'Copied stock replenishment plan',
      type: 'info',
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isThai ? 'PRODX AI วางแผนเติมสต็อกอัจฉริยะ (Smart Stock Replenishment)' : 'PRODX AI Smart Replenishment Planner'}
      maxWidth="lg"
    >
      <div className="space-y-4 font-sans">
        {/* Metric Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-border border-crisp bg-background text-center">
            <div className="text-xs text-slate-500 font-semibold">{isThai ? 'สินค้าทั้งหมด' : 'Total SKUs'}</div>
            <div className="text-lg font-black text-text mt-0.5">{products.length}</div>
          </div>
          <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 text-center">
            <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold">{isThai ? 'ใกล้หมดสต็อก' : 'Low Stock'}</div>
            <div className="text-lg font-black text-amber-600 dark:text-amber-300 mt-0.5">{lowStockItems.length}</div>
          </div>
          <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-center">
            <div className="text-xs text-rose-700 dark:text-rose-400 font-semibold">{isThai ? 'หมดสต็อก (0)' : 'Out of Stock'}</div>
            <div className="text-lg font-black text-rose-600 dark:text-rose-300 mt-0.5">{outOfStockItems.length}</div>
          </div>
        </div>

        {/* Action button */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text/60">
            {isThai
              ? 'AI จะวิเคราะห์รายการของขาดเพื่อจัดลำดับความเร่งด่วนและปริมาณสั่งซื้อ'
              : 'AI synthesizes supply velocity and prioritizes purchase orders.'}
          </p>
          <div className="flex items-center gap-2">
            {aiReport && (
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                {copied ? (isThai ? 'คัดลอกแล้ว' : 'Copied') : (isThai ? 'คัดลอก' : 'Copy')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleRunOptimization}
              disabled={isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta font-semibold"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  {isThai ? 'กำลังคำนวณแผน...' : 'Calculating Plan...'}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  {aiReport
                    ? (isThai ? 'วิเคราะห์ใหม่' : 'Re-analyze')
                    : (isThai ? 'วิเคราะห์และวางแผนสต็อก' : 'Generate Stock Plan')}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Report Output Box */}
        <div className="min-h-[220px] max-h-80 overflow-y-auto rounded-xl border border-border border-crisp bg-slate-50/70 dark:bg-slate-950/50 p-4 text-xs sm:text-sm text-text leading-relaxed whitespace-pre-wrap">
          {aiReport ? (
            aiReport
          ) : (
            <div className="h-44 flex flex-col items-center justify-center text-center text-slate-400">
              <Boxes className="h-8 w-8 text-primary mb-2 opacity-80" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {isThai
                  ? 'กดปุ่ม "วิเคราะห์และวางแผนสต็อก" เพื่อให้ AI แนะนำรายการสั่งของ'
                  : 'Click "Generate Stock Plan" to view AI replenishment suggestions.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
