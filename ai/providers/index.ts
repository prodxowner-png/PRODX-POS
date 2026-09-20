import type { AIProvider } from "../core/types";
import { GeminiAIProvider } from "./gemini";
import { OfflineAIProvider } from "./offline";

export interface DefaultAIProviderOptions {
  geminiApiKey?: string;
  geminiModel?: string;
}

export function createDefaultAIProviders(options: DefaultAIProviderOptions = {}): readonly AIProvider[] {
  const providers: AIProvider[] = [];

  if (options.geminiApiKey ?? process.env.GEMINI_API_KEY) {
    providers.push(new GeminiAIProvider({
      apiKey: options.geminiApiKey,
      model: options.geminiModel,
    }));
  }

  providers.push(new OfflineAIProvider());
  return providers;
}
