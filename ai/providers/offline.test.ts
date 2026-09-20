import test from "node:test";
import assert from "node:assert/strict";
import { OfflineAIProvider } from "./offline";

test("offline provider does not fabricate authoritative state", async () => {
  const response = await new OfflineAIProvider().respond({
    actor: "assistant",
    channel: "voice",
    mode: "offline",
    sessionId: "offline-session",
    input: "what is the current stock?",
  }, []);

  assert.equal(response.provider, "offline");
  assert.equal(response.toolCalls.length, 0);
  assert.match(response.text, /will not invent/i);
});
