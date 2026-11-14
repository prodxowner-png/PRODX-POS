import { describe, expect, it } from "vitest";
import { recoveryReplayOutcome } from "../src/recovery-outcome";

describe("operator recovery idempotent replay outcome", () => {
  it("returns FAILED when the authorized retry generation later fails", () => {
    expect(recoveryReplayOutcome("RETRY", "FAILED")).toBe("FAILED");
  });

  it("returns the current committed, voided, or retry checkpoint outcome", () => {
    expect(recoveryReplayOutcome("RETRY", "COMMITTED")).toBe("COMMITTED");
    expect(recoveryReplayOutcome("RETRY", "VOIDED")).toBe("VOIDED");
    expect(recoveryReplayOutcome("VOID", "RETRY")).toBe("RETRY");
  });

  it("uses the persisted disposition only when a legacy checkpoint row is absent", () => {
    expect(recoveryReplayOutcome("RETRY", undefined)).toBe("RETRY");
    expect(recoveryReplayOutcome("VOID", undefined)).toBe("VOIDED");
  });
});
