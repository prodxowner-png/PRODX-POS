import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { useToast } from '../../../context/ToastContext';
import { useLanguage } from '../../../context/LanguageContext';
import { aiService } from '../../../services/aiService';

interface AiDashboardInsightsWidgetProps {
  totalRevenue: string;
  totalOrders: number;
  topProducts: Array<{ name: string; qty: number; revenue: string }>;
  paymentBreakdown: Record<string, string>;
  dateRangeText: string;
  timeframeText: string;
  onOpenSettings?: () => void;
}

export const AiDashboardInsightsWidget: React.FC<AiDashboardInsightsWidgetProps> = ({
  totalRevenue,
  totalOrders,
  topProducts,
  paymentBreakdown,
  dateRangeText,
  timeframeText,
  onOpenSettings,
}) => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';

  const [insightText, setInsightText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasGenerated, setHasGenerated] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const handleGenerateInsights = async () => {
    setIsLoading(true);
    try {
      const result = await aiService.analyzeSalesDashboard({
        totalRevenue,
        totalOrders,
        topProducts,
        paymentBreakdown,
        dateRange: dateRangeText,
        timeframe: timeframeText,
      });
      setInsightText(result);
      setHasGenerated(true);
    } catch (err: any) {
      addToast({
        title: isThai ? 'ไม่สามารถวิเคราะห์ด้วย AI ได้' : 'AI Analysis Failed',
        message: err.message || 'Error occurred while contacting PRODX AI service',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!insightText) return;
    navigator.clipboard.writeText(insightText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    addToast({
      title: isThai ? 'คัดลอกเรียบร้อย' : 'Copied to Clipboard',
      message: isThai ? 'คัดลอกบทวิเคราะห์ AI ลงคลิปบอร์ดแล้ว' : 'AI insight copied to clipboard',
      type: 'info',
    });
  };

  return (
    <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/70 via-white to-blue-50/50 dark:from-slate-900 dark:via-indigo-950/20 dark:to-slate-900 p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-text">
                {isThai ? 'PRODX AI สรุปวิเคราะห์ยอดขายและกลยุทธ์' : 'PRODX AI Executive Sales Insights'}
              </h3>
              <Badge variant="primary" className="bg-indigo-600 text-white text-[10px] uppercase font-bold tracking-wider">
                Powered by Gemini
              </Badge>
            </div>
            <p className="text-xs text-text/60">
              {isThai
                ? 'วิเคราะห์อัตโนมัติจากข้อมูลยอดขาย สถิติออเดอร์ และสินค้าขายดีประจำช่วงเวลา'
                : 'Intelligent synthesis based on real-time sales telemetry & velocity.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasGenerated && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs font-semibold"
            >
              {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? (isThai ? 'คัดลอกแล้ว' : 'Copied') : (isThai ? 'คัดลอก' : 'Copy')}
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerateInsights}
            disabled={isLoading}
            className="text-xs font-semibold shadow-sm"
          >
            {isLoading ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {isThai ? 'AI กำลังคิดวิเคราะห์...' : 'Generating Insights...'}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {hasGenerated
                  ? (isThai ? 'วิเคราะห์ข้อมูลใหม่อีกครั้ง' : 'Regenerate Analysis')
                  : (isThai ? 'สร้างบทวิเคราะห์ AI ตอนนี้' : 'Analyze with AI')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Insight Content Box */}
      {hasGenerated && insightText ? (
        <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-white/90 dark:bg-slate-900/90 p-4.5 text-sm text-text leading-relaxed whitespace-pre-wrap font-sans shadow-inner">
          {insightText}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 px-4 text-center rounded-xl border border-dashed border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/10">
          <Lightbulb className="h-8 w-8 text-indigo-400 mb-2 opacity-80" />
          <p className="text-xs font-medium text-text/80">
            {isThai
              ? 'กดปุ่ม "สร้างบทวิเคราะห์ AI ตอนนี้" เพื่อให้ PRODX AI สรุปภาพรวมยอดขายและแนะนำกลยุทธ์เพิ่มกำไร'
              : 'Click "Analyze with AI" to generate business insights and actionable upselling strategies.'}
          </p>
          <span className="text-[11px] text-slate-400 mt-1">
            {isThai
              ? `วิเคราะห์จากยอดขาย ${totalRevenue} (${totalOrders} ออเดอร์)`
              : `Based on current telemetry: ${totalRevenue} (${totalOrders} orders)`}
          </span>
        </div>
      )}
    </div>
  );
};
