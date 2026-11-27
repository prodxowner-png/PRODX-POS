/** Authenticated PRODX AI client. Provider credentials never enter the browser. */

export interface AiConfig {
  model: string;
  enabled: boolean;
  temperature: number;
}

export const AI_BACKEND_CHAT_PATH = '/api/v1/ai/chat';

export const DEFAULT_AI_CONFIG: AiConfig = {
  model: 'google/gemini-3.8-flash',
  enabled: true,
  temperature: 0.7,
};

const STORAGE_KEY = 'prodx_ai_service_config';
const FORBIDDEN_STORED_KEYS = ['apiKey', 'endpoint', 'baseUrl', 'authorization', 'token'] as const;

export type AiChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class AiService {
  private static instance: AiService;
  private sessionToken: string | null = null;
  private constructor() {}

  /**
   * The authenticated session token is supplied by AuthContext (in memory).
   * This service never reads or writes session storage itself.
   */
  public setSessionToken(token: string | null | undefined): void {
    this.sessionToken = typeof token === 'string' && token.trim() ? token.trim() : null;
  }
  public static getInstance(): AiService { if (!AiService.instance) AiService.instance = new AiService(); return AiService.instance; }

  public getConfig(): AiConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { ...DEFAULT_AI_CONFIG };
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const hadForbidden = FORBIDDEN_STORED_KEYS.some((key) => key in parsed);
      const config = this.sanitize(parsed);
      if (hadForbidden) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      return config;
    } catch {
      return { ...DEFAULT_AI_CONFIG };
    }
  }

  public saveConfig(config: Partial<AiConfig>): AiConfig {
    const updated = this.sanitize({ ...this.getConfig(), ...config } as Record<string, unknown>);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  private sanitize(value: Record<string, unknown>): AiConfig {
    const requestedModel = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_AI_CONFIG.model;
    const model = requestedModel === 'gemini-3.8-flash' ? DEFAULT_AI_CONFIG.model : requestedModel;
    const temperature = typeof value.temperature === 'number' && Number.isFinite(value.temperature)
      ? Math.min(1, Math.max(0, value.temperature))
      : DEFAULT_AI_CONFIG.temperature;
    const enabled = typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AI_CONFIG.enabled;
    return { model, temperature, enabled };
  }

  public async chatCompletion(messages: AiChatMessage[], overrides?: Partial<AiConfig>): Promise<string> {
    const config = this.sanitize({ ...this.getConfig(), ...overrides } as Record<string, unknown>);
    if (!config.enabled) throw new Error('ฟีเจอร์ผู้ช่วย AI ถูกปิดใช้งานอยู่');

    if (!this.sessionToken) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.sessionToken}`,
    };

    const res = await fetch(AI_BACKEND_CHAT_PATH, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ messages, model: config.model === DEFAULT_AI_CONFIG.model ? undefined : config.model, temperature: config.temperature }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      let detail = errorText;
      try {
        const json = JSON.parse(errorText);
        detail = json.error?.message || json.message || errorText;
      } catch {}
      if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI');
      if (res.status === 403) throw new Error('บัญชีของคุณไม่มีสิทธิ์ ai:use สำหรับผู้ช่วย AI');
      throw new Error(`AI API Error (${res.status}): ${detail || res.statusText}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('ไม่พบคำตอบจาก AI Gateway');
    return reply;
  }

  public async askFrontendAssistant(
    prompt: string,
    history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<string> {
    const config = this.sanitize(this.getConfig() as unknown as Record<string, unknown>);
    if (!config.enabled) throw new Error('ฟีเจอร์ผู้ช่วย AI ถูกปิดใช้งานอยู่');
    if (!this.sessionToken) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI');

    const res = await fetch('/api/v1/ai/frontend-assistant', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify({
        prompt,
        history,
        model: config.model === DEFAULT_AI_CONFIG.model ? undefined : config.model,
        temperature: config.temperature,
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI');
      if (res.status === 403) throw new Error('บัญชีของคุณไม่มีสิทธิ์ ai:use สำหรับผู้ช่วย AI');
      throw new Error('ขออภัยครับ เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI Assistant');
    }

    const data = await res.json();
    const reply = typeof data?.response === 'string' && data.response.trim()
      ? data.response.trim()
      : data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('ไม่พบคำตอบจาก AI Gateway');
    return reply;
  }

  public async analyzeSalesDashboard(context: { totalRevenue: string; totalOrders: number; topProducts: Array<{ name: string; qty: number }>; paymentBreakdown: Record<string, string>; dateRange: string; timeframe: string }): Promise<string> {
    const systemPrompt = 'คุณเป็น PRODX AI ผู้เชี่ยวชาญการวิเคราะห์ธุรกิจร้านค้าและการขาย (POS & Retail Analytics Specialist) ตอบเป็นภาษาไทยแบบมืออาชีพ กระชับ ชัดเจน วิเคราะห์เฉพาะข้อมูลที่ได้รับเท่านั้น ห้ามแต่งยอดขาย จำนวนสินค้า ช่วงเวลาพีค สินค้าขายดี หรือสาเหตุที่ไม่มีอยู่ในข้อมูล หากข้อมูลไม่เพียงพอให้ระบุอย่างตรงไปตรงมา';
    const topProducts = context.topProducts.length
      ? context.topProducts.map((p) => `${p.name} - ${p.qty} ชิ้น`).join('; ')
      : 'ไม่มีข้อมูลรายการสินค้าที่ขายและยืนยันแล้วในช่วงนี้';
    const userPrompt = `วิเคราะห์ข้อมูลช่วง "${context.timeframe}" (${context.dateRange}): ยอดขายรวม ${context.totalRevenue}; จำนวนคำสั่งซื้อที่ยืนยันแล้ว ${context.totalOrders}; ช่องทางชำระเงิน ${JSON.stringify(context.paymentBreakdown)}; 5 อันดับสินค้าตามจำนวนขายที่ยืนยันแล้ว: ${topProducts}. หากไม่มีข้อมูลสินค้า ห้ามคาดเดาหรือสร้างอันดับสินค้า ให้สรุปเฉพาะยอดขายและจำนวนคำสั่งซื้อที่มี และเสนอขั้นตอนตรวจสอบข้อมูลเพิ่มเติมแทน`;
    return this.chatCompletion([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
  }

  public async getPosRecommendation(context: { cartItems: Array<{ name: string; qty: number; price: string; category?: string }>; availableProducts: Array<{ name: string; price: string; category?: string; stock: number }>; customerName?: string; customerTier?: string }): Promise<string> {
    const systemPrompt = 'คุณคือ PRODX AI ผู้ช่วยแคชเชียร์อัจฉริยะสำหรับ POS ตอบภาษาไทย สุภาพ กระชับ และให้คำแนะนำที่ไม่เปลี่ยนแปลงสถานะ POS';
    const userPrompt = `ตะกร้า: ${context.cartItems.map((item) => `${item.name} x${item.qty} (${item.price})`).join('; ') || '(ว่าง)'}; ลูกค้า: ${context.customerName ?? 'ทั่วไป'}; สต็อกที่มี: ${context.availableProducts.slice(0, 15).map((p) => `${p.name} (${p.price}, คงเหลือ ${p.stock})`).join('; ')}. แนะนำสินค้า/ประโยค upsell 2-3 ข้อ`;
    return this.chatCompletion([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
  }

  public async optimizeInventory(context: { lowStockProducts: Array<{ name: string; stock: number; minStock: number; category: string }>; totalProductsCount: number; outOfStockCount: number }): Promise<string> {
    const systemPrompt = 'คุณคือ PRODX AI ผู้เชี่ยวชาญคลังสินค้าและการเติมสินค้า ตอบเป็นภาษาไทย ชัดเจน กระชับ และไม่สั่งแก้ไขสต็อกโดยตรง';
    const userPrompt = `คลัง: ทั้งหมด ${context.totalProductsCount}; หมด ${context.outOfStockCount}; สินค้าสต็อกต่ำ: ${context.lowStockProducts.map((p) => `${p.name} (${p.stock}/min ${p.minStock}, ${p.category})`).join('; ')}. จัดลำดับความเร่งด่วนและแนะนำปริมาณเติม`;
    return this.chatCompletion([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
  }

  public async generateProductDetails(productName: string, categoryHint?: string): Promise<{ description: string; suggestedCategory: string; suggestedPrice: number; tags: string[]; sellingPoints: string[] }> {
    const raw = await this.chatCompletion([
      { role: 'system', content: 'คุณคือ PRODX AI สำหรับสร้างรายละเอียดสินค้า ส่ง JSON เท่านั้นตาม schema: description:string,suggestedCategory:string,suggestedPrice:number,tags:string[],sellingPoints:string[]' },
      { role: 'user', content: `สร้างรายละเอียดสำหรับสินค้า "${productName}" ${categoryHint ? `หมวดหมู่: ${categoryHint}` : ''}` },
    ]);
    try {
      return JSON.parse(raw.replace(/\`\`\`json/gi, '').replace(/\`\`\`/gi, '').trim());
    } catch {
      throw new Error('AI Gateway returned invalid product JSON.');
    }
  }
}

export const aiService = AiService.getInstance();
