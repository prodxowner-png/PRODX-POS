import type { AIChatRequest, AIChatResponse, AIMessage } from './types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 20_000;

export type GeminiErrorKind = 'auth' | 'invalid_request' | 'rate_limit' | 'transient' | 'provider' | 'timeout';

export class GeminiProviderError extends Error {
  constructor(readonly kind: GeminiErrorKind, readonly status: number | undefined, message: string, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'GeminiProviderError';
  }
}

export interface GeminiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  allowedModels?: readonly string[];
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
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
  const contents = messages.filter((m) => m.role !== 'system').map((message) => ({
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
  return parts.filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
    .filter((part) => typeof part.text === 'string').map((part) => part.text as string).join('');
}

function parseRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 10_000);
  return undefined;
}

function classifyStatus(status: number): { kind: GeminiErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 400 || status === 404 || status === 422) return { kind: 'invalid_request', retryable: false };
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status === 408 || status === 409 || status === 500 || status === 502 || status === 503 || status === 504) return { kind: 'transient', retryable: true };
  return { kind: 'provider', retryable: status >= 500 };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiProvider {
  readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly allowedModels: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL);
    this.defaultModel = config.defaultModel ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    this.allowedModels = new Set(config.allowedModels ?? [this.defaultModel]);
    this.timeoutMs = Math.max(1_000, Number(config.timeoutMs ?? process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
    this.maxRetries = Math.max(0, Math.min(3, Number(config.maxRetries ?? DEFAULT_MAX_RETRIES)));
    this.retryBaseMs = Math.max(50, Math.min(5_000, Number(config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS)));
    this.sleep = config.sleep ?? defaultSleep;

    if (!this.apiKey) throw new Error('Gemini AI is not configured: GEMINI_API_KEY is missing.');
    if (!/^gemini-[a-z0-9._-]+$/i.test(this.defaultModel)) throw new Error('Gemini AI model must be a Gemini model identifier.');
    if (this.allowedModels.size === 0) throw new Error('At least one Gemini AI model must be allowed.');
    for (const model of this.allowedModels) if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw new Error('Only Gemini models are allowed.');
  }

  async chat(request: AIChatRequest): Promise<AIChatResponse> {
    this.validateRequest(request);
    const model = request.model ?? this.defaultModel;
    if (!this.allowedModels.has(model)) throw new GeminiProviderError('invalid_request', 400, 'The requested Gemini model is not allowed.', false);
    const payload = normalizeContent(request.messages);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            ...payload,
            generationConfig: {
              ...(request.max_tokens === undefined ? {} : { maxOutputTokens: request.max_tokens }),
              ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const classification = classifyStatus(response.status);
          const retryAfterMs = parseRetryAfterMs(response);
          const error = new GeminiProviderError(classification.kind, response.status, `Gemini AI request failed (${response.status}).`, classification.retryable, retryAfterMs);
          if (error.retryable && attempt < this.maxRetries) {
            const backoff = retryAfterMs ?? Math.min(10_000, this.retryBaseMs * (2 ** attempt));
            const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(backoff / 4)));
            await this.sleep(backoff + jitter);
            continue;
          }
          throw error;
        }

        const raw = (await response.json()) as Record<string, unknown>;
        const text = extractText(raw);
        if (!text.trim()) throw new GeminiProviderError('provider', response.status, 'Gemini AI returned no text content.', false);
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
        if (error instanceof GeminiProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new GeminiProviderError('timeout', undefined, `Gemini AI request timed out after ${this.timeoutMs}ms.`, true);
          if (attempt < this.maxRetries) {
            const backoff = Math.min(10_000, this.retryBaseMs * (2 ** attempt));
            const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(backoff / 4)));
            await this.sleep(backoff + jitter);
            continue;
          }
          throw timeoutError;
        }
        throw new GeminiProviderError('transient', undefined, 'Gemini AI request could not be completed.', true);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new GeminiProviderError('provider', undefined, 'Gemini AI request failed.', false);
  }

  private validateRequest(request: AIChatRequest): void {
    if (!Array.isArray(request.messages) || request.messages.length === 0) throw new Error('AI request must contain at least one message.');
    if (request.messages.length > MAX_MESSAGES) throw new Error(`AI request exceeds the ${MAX_MESSAGES}-message limit.`);
    for (const message of request.messages) if (!message.content.trim() || message.content.length > MAX_MESSAGE_CHARS) throw new Error('AI message content is empty or exceeds the allowed size.');
    const model = request.model ?? this.defaultModel;
    if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw new Error('Only Gemini models are allowed.');
    if (request.stream) throw new Error('Gemini provider does not support streaming through this boundary yet.');
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw new Error('AI temperature must be between 0 and 2.');
    if (request.max_tokens !== undefined && (!Number.isInteger(request.max_tokens) || request.max_tokens < 1)) throw new Error('AI max_tokens must be a positive integer.');
  }
}
