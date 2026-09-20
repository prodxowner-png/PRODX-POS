import { GoogleGenAI, Type } from "@google/genai";
import type { AIProvider, AIRequest, AIResponse, AIToolDefinition } from "../core/types";

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
}

export class GeminiAIProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for the Gemini API provider");
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  }

  supports(mode: "online" | "hybrid" | "offline"): boolean {
    return mode === "online" || mode === "hybrid";
  }

  async respond(request: AIRequest, tools: readonly AIToolDefinition[]): Promise<AIResponse> {
    const functionDeclarations = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: Type.OBJECT, properties: {} },
    }));

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: request.input,
      config: functionDeclarations.length > 0
        ? { tools: [{ functionDeclarations }] }
        : undefined,
    });

    return {
      text: response.text ?? "",
      toolCalls: (response.functionCalls ?? []).map((call) => {
        const definition = tools.find((tool) => tool.name === call.name);
        return {
          name: call.name ?? "",
          arguments: (call.args ?? {}) as Record<string, unknown>,
          authoritative: definition?.authoritative ?? false,
        };
      }),
      mode: request.mode,
      provider: this.name,
    };
  }
}
