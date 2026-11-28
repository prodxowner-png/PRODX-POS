import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  RefreshCw,
  Send,
  X,
  TrendingUp,
  Package,
  ShoppingBag,
  Lightbulb,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { Product } from '../../domain/catalog';
import { formatMoney } from '../../domain/money';
import { aiService } from '../../services/aiService';

interface PosAiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onAddProductToCart: (product: Product) => void;
}

export const PosAiAssistantModal: React.FC<PosAiAssistantModalProps> = ({
  isOpen,
  onClose,
  products,
  onAddProductToCart,
}) => {
  const { items, totals } = useCart();
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';

  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [userQuery, setUserQuery] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'ai' | 'user'; text: string }>>([]);

  const handleAskAi = async (customPrompt?: string) => {
    setIsLoading(true);
    const query = customPrompt || userQuery;

    try {
      if (customPrompt || !query) {
        // Generate contextual cross-selling / upselling recommendations based on current cart
        const cartItemsSummary = items.map((item) => ({
          name: item.product.name || 'Product',
          qty: item.quantity,
          price: formatMoney(item.unitPrice),
        }));

        const availableProductsSummary = products.map((p) => ({
          name: p.name || 'Product',
          price: formatMoney(p.price),
          stock: p.currentStock,
        }));

        const result = await aiService.getPosRecommendation({
          cartItems: cartItemsSummary,
          availableProducts: availableProductsSummary,
        });

        setAiSuggestion(result);
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'ai',
            text: result,
          },
        ]);
      } else {
        // User asked specific question in cashier chat
        setChatHistory((prev) => [...prev, { role: 'user', text: query }]);
        setUserQuery('');

        const result = await aiService.chatCompletion([
          {
            role: 'system',
            content: `คุณคือ AI ผู้ช่วยแคชเชียร์อัจฉริยะประจำจุดขาย POS ตอบคำถามเกี่ยวกับการขาย โปรโมชั่น การจับคู่สินค้า และสินค้าในร้าน (${products.length} รายการ) เป็นภาษาไทย สุภาพ และกระชับ`,
          },
          ...chatHistory.map((h) => ({
            role: (h.role === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: h.text,
          })),
          { role: 'user', content: query },
        ]);

        setChatHistory((prev) => [...prev, { role: 'ai', text: result }]);
      }
    } catch (err: any) {
      addToast({
        title: isThai ? 'ไม่สามารถเชื่อมต่อ AI ได้' : 'AI Request Failed',
        message: err.message || 'Error occurred while contacting AI service',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isThai ? 'PRODX AI ผู้ช่วยแคชเชียร์อัจฉริยะ (POS Smart Assistant)' : 'PRODX AI Smart Cashier Assistant'}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Cart Summary Banner */}
        <div className="p-3.5 rounded-xl bg-brand-surface-muted border border-brand-border border-crisp flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-brand-surface-selected text-brand-text-accent shrink-0">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-brand-text-secondary">
                {isThai ? 'สถานะตะกร้าปัจจุบัน' : 'Current Active Cart'}
              </div>
              <div className="text-sm font-bold text-brand-text truncate tabular-nums">
                {items.length} {isThai ? 'รายการ' : 'items'} · {formatMoney(totals.grandTotal)}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleAskAi('แนะนำสินค้าขายคู่กัน')}
            disabled={isLoading}
            className="min-h-[44px] bg-brand-primary hover:bg-brand-primary-hover text-brand-primary-text text-xs font-semibold shrink-0"
          >
            {isLoading ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            )}
            {isThai ? 'AI แนะนำสินค้าจับคู่' : 'Recommend Upsell'}
          </Button>
        </div>

        {/* Chat / Recommendation Stream */}
        <div
          role="log"
          aria-live="polite"
          aria-label={isThai ? 'ประวัติการสนทนากับผู้ช่วย AI' : 'AI assistant conversation log'}
          className="max-h-[42svh] min-h-[200px] overflow-y-auto rounded-xl border border-brand-border border-crisp bg-brand-surface-muted p-4 space-y-3 font-sans"
        >
          {chatHistory.length === 0 ? (
            <div className="min-h-[168px] flex flex-col items-center justify-center text-center p-6 text-brand-text-secondary">
              <Bot className="h-10 w-10 text-brand-text-accent mb-2 opacity-90" />
              <p className="text-sm font-medium text-brand-text">
                {isThai ? 'สวัสดีครับ! ผมคือผู้ช่วย AI ประจำเครื่องคิดเงิน' : 'Hello! I am your POS AI Assistant'}
              </p>
              <p className="text-xs text-brand-text-secondary mt-1 max-w-sm">
                {isThai
                  ? 'กดปุ่ม "AI แนะนำสินค้าจับคู่" ด้านบน หรือพิมพ์สอบถามเกี่ยวกับการขาย/สินค้าได้ทันที'
                  : 'Click "Recommend Upsell" or type any cashier query below.'}
              </p>
            </div>
          ) : (
            chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'ai' && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-primary text-brand-primary-text shrink-0 mt-0.5 shadow-xs">
                    <Sparkles className="h-4 w-4" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-brand-primary text-brand-primary-text rounded-tr-none'
                      : 'bg-brand-surface border border-brand-border border-crisp text-brand-text rounded-tl-none shadow-xs'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (userQuery.trim()) handleAskAi();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            aria-label={isThai ? 'พิมพ์คำถามถึงผู้ช่วย AI' : 'Ask the POS AI assistant'}
            placeholder={isThai ? 'พิมพ์คำถามหรือขอคำแนะนำจาก AI เช่น "แนะนำเครื่องดื่มคู่กับครัวซองต์"...' : 'Ask AI anything about menu, upsell, promotions...'}
            className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-brand-border border-crisp bg-brand-surface text-brand-text placeholder:text-brand-text-muted text-base sm:text-sm focus:ring-2 focus:ring-cta focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={isLoading || !userQuery.trim()}
            aria-label={isThai ? 'ส่งคำถาม' : 'Send message'}
            className="bg-brand-primary hover:bg-brand-primary-hover text-brand-primary-text min-h-[44px] min-w-[44px]"
          >
            {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </Modal>
  );
};
