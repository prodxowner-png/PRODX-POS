import type { AIProvider, AIRequest, AIResponse, AIToolDefinition } from "../core/types";

export class OfflineAIProvider implements AIProvider {
  readonly name = "offline";

  supports(mode: "online" | "hybrid" | "offline"): boolean {
    return mode === "offline" || mode === "hybrid";
  }

  async respond(request: AIRequest, tools: readonly AIToolDefinition[]): Promise<AIResponse> {
    void tools;
    return {
      text:
        request.mode === "offline"
          ? "PRODX Assistant is offline. I can only use locally available deterministic capabilities; authoritative server data is unavailable."
          : "PRODX Assistant is using offline fallback. I will not invent server-authoritative product, price, tax, inventory, payment, or transaction data.",
      toolCalls: [],
      mode: request.mode,
      provider: this.name,
    };
  }
}
