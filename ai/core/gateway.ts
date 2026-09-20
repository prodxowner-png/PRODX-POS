import { assertToolAllowed } from "./policy";
import type { AIProvider, AIRequest, AIResponse, AIToolDefinition } from "./types";

export class ProdxAIGateway {
  constructor(
    private readonly providers: readonly AIProvider[],
    private readonly tools: readonly AIToolDefinition[],
  ) {}

  async handle(request: AIRequest): Promise<AIResponse> {
    const availableTools = this.tools.filter((tool) => {
      try {
        assertToolAllowed(tool, request.actor, request.mode);
        return true;
      } catch {
        return false;
      }
    });

    const provider = this.providers.find((candidate) => candidate.supports(request.mode));
    if (!provider) {
      throw new Error(`No AI provider supports runtime mode ${request.mode}`);
    }

    return provider.respond(request, availableTools);
  }
}
