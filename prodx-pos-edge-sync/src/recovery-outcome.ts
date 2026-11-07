export type RecoveryDisposition = "RETRY" | "VOID";
export type RecoveryCheckpointOutcome = "FAILED" | "RETRY" | "VOIDED" | "COMMITTED";
export type RecoveryReplayOutcome = RecoveryCheckpointOutcome;

/**
 * An idempotent operator request must report the current origin checkpoint,
 * not merely echo the original disposition. A RETRY can later fail in a newer
 * delivery generation; in that case replaying the same request_id must return
 * FAILED while preserving the original resolution record.
 */
export function recoveryReplayOutcome(
  priorDisposition: RecoveryDisposition,
  currentFailureOutcome: RecoveryCheckpointOutcome | undefined
): RecoveryReplayOutcome {
  if (currentFailureOutcome) return currentFailureOutcome;
  // Compatibility for older resolution records whose checkpoint has no
  // corresponding terminal failure row.
  return priorDisposition === "VOID" ? "VOIDED" : "RETRY";
}
