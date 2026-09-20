import type { AIActor, AIRuntimeMode, AIToolDefinition } from "./types";

const PROTECTED = new Set([
  "payment.capture",
  "payment.refund",
  "inventory.adjust",
  "auth.change_permissions",
  "database.migrate",
  "production.deploy",
]);

export function assertToolAllowed(
  tool: AIToolDefinition,
  actor: AIActor,
  mode: AIRuntimeMode,
): void {
  if (!tool.allowedActors.includes(actor)) {
    throw new Error(`AI policy denied actor ${actor} for tool ${tool.name}`);
  }
  if (!tool.allowedModes.includes(mode)) {
    throw new Error(`AI policy denied mode ${mode} for tool ${tool.name}`);
  }
  if (PROTECTED.has(tool.name) && !tool.authoritative) {
    throw new Error(`Protected tool ${tool.name} must be backed by an authoritative PRODX service`);
  }
}

export function isProtectedTool(name: string): boolean {
  return PROTECTED.has(name);
}
