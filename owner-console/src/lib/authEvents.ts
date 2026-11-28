import type { OwnerAuthState } from './authFlow.ts';

/**
 * Auth events that only restate an already-known session (initial load, tab refocus,
 * silent token refresh). They never change *who* is signed in.
 */
const PASSIVE_AUTH_EVENTS: ReadonlySet<string> = new Set([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'TOKEN_REFRESHED',
]);

export interface AuthEventContext {
  /** Event name emitted by `supabase.auth.onAuthStateChange`. */
  event: string;
  /** Owner auth state currently rendered by the console. */
  state: OwnerAuthState;
  /** User id the pending MFA enrollment/challenge was started for, if any. */
  pendingMfaUserId: string | null;
  /** User id carried by the event's session, or null when the session is gone. */
  nextUserId: string | null;
}

/**
 * Decides whether an auth event must trigger a full owner re-evaluation.
 *
 * Re-evaluation clears the TOTP QR code and one-time inputs. Supabase re-emits
 * `SIGNED_IN` when a tab regains focus, so on mobile (switching to the Authenticator
 * app and back) a blind re-evaluation would discard the QR code of an enrollment that
 * is already in progress and force the Owner to create a second, conflicting factor.
 *
 * Skipping is only allowed while an MFA step is pending for the *same* user and the
 * event is passive. Those screens expose no privileged UI, and access can only be
 * granted through the explicit verify path, which re-runs the full server-side
 * evaluation. A lost session, a different user, or any non-passive event always
 * re-evaluates (fail closed).
 */
export function shouldReevaluateOnAuthEvent(context: AuthEventContext): boolean {
  if (context.nextUserId === null) return true;

  const mfaStepPending =
    context.state === 'mfa-enroll' || context.state === 'mfa-challenge';

  if (
    mfaStepPending &&
    PASSIVE_AUTH_EVENTS.has(context.event) &&
    context.pendingMfaUserId !== null &&
    context.pendingMfaUserId === context.nextUserId
  ) {
    return false;
  }

  return true;
}
