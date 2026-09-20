import test from "node:test";
import assert from "node:assert/strict";
import { ProdxAIGateway } from "./gateway";
import type { AIProvider, AIToolDefinition } from "./types";

const readTool: AIToolDefinition = {
  name: "catalog.search",
  description: "Search products.",
  authoritative: true,
  allowedActors: ["assistant"],
  allowedModes: ["online", "hybrid", "offline"],
  execute: async () => ({ ok: true }),
};

function provider(name: string, modes: Array<"online" | "hybrid" | "offline">): AIProvider {
  return {
    name,
    supports: (mode) => modes.includes(mode),
    respond: async (request) => ({
      text: name,
      toolCalls: [],
      mode: request.mode,
      provider: name,
    }),
  };
}

test("gateway exposes only policy-approved tools to a provider", async () => {
  let seen: readonly AIToolDefinition[] = [];
  const observingProvider: AIProvider = {
    name: "observer",
    supports: () => true,
    respond: async (request, tools) => {
      seen = tools;
      return { text: "ok", toolCalls: [], mode: request.mode, provider: "observer" };
    },
  };

  const gateway = new ProdxAIGateway([observingProvider], [readTool, {
    ...readTool,
    name: "payment.capture",
    authoritative: false,
  }]);

  await gateway.handle({
    actor: "assistant",
    channel: "text",
    mode: "online",
    sessionId: "test-session",
    input: "show products",
  });

  assert.deepEqual(seen.map((tool) => tool.name), ["catalog.search"]);
});

test("gateway selects the first provider supporting the requested mode", async () => {
  const gateway = new ProdxAIGateway(
    [provider("online", ["online"]), provider("offline", ["offline", "hybrid"])],
    [],
  );

  const response = await gateway.handle({
    actor: "assistant",
    channel: "text",
    mode: "offline",
    sessionId: "test-session",
    input: "hello",
  });

  assert.equal(response.provider, "offline");
});
