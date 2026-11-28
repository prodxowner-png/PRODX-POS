import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchOwnerAuditEvents } from "../src/lib/audit.ts";

describe("fetchOwnerAuditEvents", () => {
  it("invokes the server-only audit endpoint with the current session token", async () => {
    const calls = [];
    const expected = [{
      event_id: "22222222-2222-4222-8222-222222222222",
      occurred_at: "2026-11-21T08:00:00.000Z",
      event_type: "auth.login",
      actor_user_id: "11111111-1111-4111-8111-111111111111",
      outcome: null,
      reason_code: null,
      source: "supabase_auth",
    }];
    const events = await fetchOwnerAuditEvents({
      functions: {
        async invoke(name, options) {
          calls.push({ name, options });
          return { data: { events: expected }, error: null };
        },
      },
    }, "owner-access-token");
    assert.deepEqual(events, expected);
    assert.equal(calls[0].name, "owner-audit");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.headers.Authorization, "Bearer owner-access-token");
  });

  it("does not call the endpoint without a session token", async () => {
    let called = false;
    await assert.rejects(
      fetchOwnerAuditEvents({
        functions: { async invoke() { called = true; return { data: null, error: null }; } },
      }, " "),
      /unauthorized/,
    );
    assert.equal(called, false);
  });

  it("fails closed when the endpoint or audit persistence is unavailable", async () => {
    await assert.rejects(
      fetchOwnerAuditEvents({
        functions: { async invoke() { return { data: null, error: new Error("internal") }; } },
      }, "owner-access-token"),
      /audit_unavailable/,
    );
    await assert.rejects(
      fetchOwnerAuditEvents({
        functions: { async invoke() { return { data: {}, error: null }; } },
      }, "owner-access-token"),
      /audit_unavailable/,
    );
  });
});
