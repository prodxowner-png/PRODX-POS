import React, { useState } from 'react';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import { aiService } from '../../services/aiService';

export function FrontendAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: 'สวัสดีครับ! ผมคือ Gemini AI Assistant ประจำ PRODX-POS พร้อมช่วยเหลือคุณในการใช้งานระบบ, ค้นหาสินค้า, ตรวจสอบคำสั่งซื้อ หรือตอบข้อสงสัยต่างๆ ครับ มีอะไรให้ผมช่วยไหมครับ?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    const priorHistory = messages;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const reply = await aiService.askFrontendAssistant(userMsg, priorHistory);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      const fallback = error instanceof Error && error.message
        ? error.message
        : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ AI ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
          title="เปิด Gemini AI Assistant"
        >
          <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
          <span className="font-medium text-sm">AI Assistant</span>
        </button>
      ) : (
        <div className="w-80 sm:w-96 bg-card rounded-2xl shadow-2xl border border-border border-crisp flex flex-col overflow-hidden max-h-[550px]">
          {/* Header */}
          <div className="bg-indigo-600 px-4 py-3 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-amber-300" />
              <div>
                <h3 className="font-semibold text-sm">Gemini Front-End AI</h3>
                <p className="text-xs text-indigo-200">Online 24/7 พร้อมช่วยเหลือคุณ</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-indigo-700 rounded-lg text-indigo-100 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50 dark:bg-slate-950/50 min-h-[300px] max-h-[380px]">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] px-3 py-2 rounded-xl text-xs sm:text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-card text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 shadow-sm rounded-bl-none'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 items-center text-slate-400 text-xs italic">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                กำลังประมวลผลคำตอบ...
              </div>
            )}
          </div>

          {/* Input Form */}
          <form onSubmit={handleSend} className="p-3 bg-card border-t border-border border-crisp flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="พิมพ์คำถามหรือขอความช่วยเหลือ..."
              className="flex-1 px-3 py-2 text-xs sm:text-sm bg-background text-slate-800 dark:text-slate-100 rounded-xl border border-transparent focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white p-2 rounded-xl transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
