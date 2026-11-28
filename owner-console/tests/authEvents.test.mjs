import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldReevaluateOnAuthEvent } from "../src/lib/authEvents.ts";

const base = {
  event: "SIGNED_IN",
  state: "mfa-enroll",
  pendingMfaUserId: "owner-1",
  nextUserId: "owner-1",
};

describe("shouldReevaluateOnAuthEvent", () => {
  it("keeps an in-progress MFA enrollment/challenge on passive events for the same user", () => {
    for (const state of ["mfa-enroll", "mfa-challenge"]) {
      for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION"]) {
        assert.equal(
          shouldReevaluateOnAuthEvent({ ...base, state, event }),
          false,
          `${state} must survive ${event}`,
        );
      }
    }
  });

  it("fails closed when the session is gone", () => {
    assert.equal(
      shouldReevaluateOnAuthEvent({ ...base, event: "SIGNED_OUT", nextUserId: null }),
      true,
    );
    assert.equal(shouldReevaluateOnAuthEvent({ ...base, nextUserId: null }), true);
  });

  it("re-evaluates when a different user appears", () => {
    assert.equal(
      shouldReevaluateOnAuthEvent({ ...base, nextUserId: "someone-else" }),
      true,
    );
  });

  it("re-evaluates when no MFA step is pending for the user", () => {
    assert.equal(
      shouldReevaluateOnAuthEvent({ ...base, pendingMfaUserId: null }),
      true,
    );
  });

  it("re-evaluates for non-passive events such as MFA verification or user updates", () => {
    for (const event of ["MFA_CHALLENGE_VERIFIED", "USER_UPDATED", "PASSWORD_RECOVERY"]) {
      assert.equal(shouldReevaluateOnAuthEvent({ ...base, event }), true, event);
    }
  });

  it("always re-evaluates outside the MFA steps, including the privileged dashboard", () => {
    for (const state of ["loading", "signed-out", "signed-in", "denied", "misconfigured"]) {
      for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION"]) {
        assert.equal(
          shouldReevaluateOnAuthEvent({ ...base, state, event }),
          true,
          `${state} must re-verify on ${event}`,
        );
      }
    }
  });
});
