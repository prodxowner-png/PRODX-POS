import { createGateway, generateText } from 'ai';
import type { AIChatRequest, AIChatResponse, AIProvider } from './types';

const DEFAULT_MODEL = 'google/gemini-3.8-flash';
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 20_000;

export interface VercelGatewayProviderConfig {
  defaultModel?: string;
  allowedModels?: readonly string[];
  fetch?: typeof globalThis.fetch;
}

function readAllowedModels(config: VercelGatewayProviderConfig, defaultModel: string): ReadonlySet<string> {
  const configured = config.allowedModels ?? (process.env.AI_GATEWAY_ALLOWED_MODELS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return new Set(configured.length > 0 ? configured : [defaultModel]);
}

/** Server-only adapter. Vercel OIDC is resolved at request time when no API key is configured. */
export class VercelGatewayProvider implements AIProvider {
  readonly name = 'vercel-ai-gateway';
  private readonly gateway;
  private readonly defaultModel: string;
  private readonly allowedModels: ReadonlySet<string>;

  constructor(config: VercelGatewayProviderConfig = {}) {
    this.gateway = createGateway(config.fetch ? { fetch: config.fetch } : undefined);
    this.defaultModel = config.defaultModel ?? process.env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL;
    this.allowedModels = readAllowedModels({ ...config, defaultModel: this.defaultModel }, this.defaultModel);
  }

  async chat(request: AIChatRequest): Promise<AIChatResponse> {
    this.validateRequest(request);
    const model = request.model ?? this.defaultModel;
    if (!this.allowedModels.has(model)) {
      throw new Error(`AI Gateway model '${model}' is not allowed by server policy.`);
    }

    // AI SDK v7 does not accept system-role entries in `messages`; keep trusted
    // policy instructions separate from caller-controlled conversation content.
    const systemInstructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map(({ role, content }) => ({ role: role as 'user' | 'assistant', content }));
    if (messages.length === 0) throw new Error('AI Gateway request must contain a user or assistant message.');

    const result = await generateText({
      model: this.gateway.languageModel(model),
      ...(systemInstructions ? { instructions: systemInstructions } : {}),
      messages,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.max_tokens === undefined ? {} : { maxOutputTokens: request.max_tokens }),
      maxRetries: 2,
    });

    return {
      id: result.response.id,
      model: result.response.modelId || model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.finishReason }],
      usage: {
        prompt_tokens: result.usage.inputTokens ?? undefined,
        completion_tokens: result.usage.outputTokens ?? undefined,
        total_tokens: result.usage.totalTokens ?? undefined,
      },
      provider: this.name,
      raw: { finishReason: result.finishReason },
    };
  }

  private validateRequest(request: AIChatRequest): void {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error('AI Gateway request must contain at least one message.');
    }
    if (request.messages.length > MAX_MESSAGES) throw new Error(`AI Gateway request exceeds the ${MAX_MESSAGES}-message limit.`);
    for (const message of request.messages) {
      if (!message.content.trim() || message.content.length > MAX_MESSAGE_CHARS) {
        throw new Error('AI Gateway message content is empty or exceeds the allowed size.');
      }
    }
    if (request.stream) throw new Error('AI Gateway streaming is not enabled on this route.');
    if (request.max_tokens !== undefined && (!Number.isInteger(request.max_tokens) || request.max_tokens < 1 || request.max_tokens > 2_000)) {
      throw new Error('AI Gateway max_tokens must be an integer between 1 and 2000.');
    }
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
      throw new Error('AI Gateway temperature must be between 0 and 2.');
    }
  }
}
