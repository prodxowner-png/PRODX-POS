export type AIChannel = "text" | "voice";
export type AIRuntimeMode = "online" | "hybrid" | "offline";
export type AIActor = "assistant" | "antigravity";

export interface AIRequest {
  actor: AIActor;
  channel: AIChannel;
  mode: AIRuntimeMode;
  sessionId: string;
  input: string;
  metadata?: Record<string, string>;
}

export interface AIResponse {
  text: string;
  toolCalls: AIToolCall[];
  mode: AIRuntimeMode;
  provider: string;
}

export interface AIToolCall {
  name: string;
  arguments: Record<string, unknown>;
  authoritative: boolean;
}

export interface AIProvider {
  readonly name: string;
  supports(mode: AIRuntimeMode): boolean;
  respond(request: AIRequest, tools: readonly AIToolDefinition[]): Promise<AIResponse>;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  authoritative: boolean;
  allowedActors: readonly AIActor[];
  allowedModes: readonly AIRuntimeMode[];
}
