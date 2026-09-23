import type { AIChatRequest, AIChatResponse, AIMessage } from './types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 20_000;

export interface GeminiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Gemini AI base URL must use HTTPS.');
  return url.toString().replace(/\/$/, '');
}

function normalizeContent(messages: readonly AIMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n').trim();
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: message.content }],
    }));
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
  };
}

function extractText(raw: Record<string, unknown>): string {
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const first = candidates[0];
  if (!first || typeof first !== 'object') return '';
  const content = (first as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return '';
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

export class GeminiProvider {
  readonly name = 'gemini';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL);
    this.defaultModel = config.defaultModel ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = Math.max(1_000, Number(config.timeoutMs ?? process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));

    if (!this.apiKey) throw new Error('Gemini AI is not configured: GEMINI_API_KEY is missing.');
    if (!/^gemini-[a-z0-9._-]+$/i.test(this.defaultModel)) {
      throw new Error('Gemini AI model must be a Gemini model identifier.');
    }
  }

  async chat(request: AIChatRequest): Promise<AIChatResponse> {
    this.validateRequest(request);
    const model = request.model ?? this.defaultModel;
    const payload = normalizeContent(request.messages);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          ...payload,
          generationConfig: {
            ...(request.max_tokens === undefined ? {} : { maxOutputTokens: request.max_tokens }),
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Gemini AI request failed (${response.status}).`);
      const raw = (await response.json()) as Record<string, unknown>;
      const text = extractText(raw);
      if (!text.trim()) throw new Error('Gemini AI returned no text content.');
      const usage = raw.usageMetadata as Record<string, unknown> | undefined;

      return {
        id: typeof raw.responseId === 'string' ? raw.responseId : undefined,
        model: typeof raw.modelVersion === 'string' ? raw.modelVersion : model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: usage ? {
          prompt_tokens: typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : undefined,
          completion_tokens: typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined,
          total_tokens: typeof usage.totalTokenCount === 'number' ? usage.totalTokenCount : undefined,
        } : undefined,
        provider: this.name,
        raw,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Gemini AI request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateRequest(request: AIChatRequest): void {
    if (!Array.isArray(request.messages) || request.messages.length === 0) throw new Error('AI request must contain at least one message.');
    if (request.messages.length > MAX_MESSAGES) throw new Error(`AI request exceeds the ${MAX_MESSAGES}-message limit.`);
    for (const message of request.messages) {
      if (!message.content.trim() || message.content.length > MAX_MESSAGE_CHARS) throw new Error('AI message content is empty or exceeds the allowed size.');
    }
    const model = request.model ?? this.defaultModel;
    if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw new Error('Only Gemini models are allowed.');
    if (request.stream) throw new Error('Gemini provider does not support streaming through this boundary yet.');
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
      throw new Error('AI temperature must be between 0 and 2.');
    }
    if (request.max_tokens !== undefined && (!Number.isInteger(request.max_tokens) || request.max_tokens < 1)) {
      throw new Error('AI max_tokens must be a positive integer.');
    }
  }
}
