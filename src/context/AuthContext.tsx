/**
 * PRODX POS - Authentication, Multi-Tenant Session & Enterprise RBAC Context
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  User,
  Store,
  Organization,
  SessionContext,
  Permission,
  Role,
  OperationalScope,
  getStoredStaffDirectory,
  saveStoredStaffDirectory,
  getStoredRolePermissions,
  saveStoredRolePermissions,
  getStoredStaffPins,
  saveStoredStaffPins,
  getStoredOperationalScope,
  saveStoredOperationalScope,
  ROLE_PERMISSIONS,
} from '../domain/auth';
import {
  CustomPermissionSet,
  DEFAULT_PERMISSION_SETS,
  getStoredCustomPermissionSets,
  saveStoredCustomPermissionSets,
} from '../domain/permissionSets';
import { authApi } from '../adapters/authApiFactory';
import { validateOrgBranchTerminalBatch } from '../services/orgBranchTerminalValidator';
import { aiService } from '../services/aiService';
import { LoginRequest, BiometricLoginRequest } from '../adapters/types';
import { auditService } from '../services/auditService';
import {
  WebAuthnChallengeRecord,
  WebAuthnAssertionPayload,
  WebAuthnVerificationResult,
  createWebAuthnChallengeRecord,
  authenticatePasskey,
  getRegisteredPasskeys,
  saveRegisteredPasskeys,
  base64URLToBuffer,
  base64URLToString,
} from '../services/webauthnService';
import {
  AUTH_SESSION_STORAGE_KEY,
  clearPersistedSession,
  readPersistedSession,
  writePersistedSession,
} from './authSessionStorage';
import { shouldReadMock } from '../adapters/env';
import { createAuthDiagnosticRequest } from './authDiagnostics';

export interface AddStaffPayload {
  name: string;
  email: string;
  role: Role;
  employeeCode: string;
  pin?: string;
  isActive?: boolean;
}

interface AuthContextType {
  session: SessionContext | null;
  operationalScope: OperationalScope | null;
  setOperationalScope: (scope: OperationalScope | null) => void;
  isLoading: boolean;
  isLocked: boolean;
  inactivityTimeoutMinutes: number;
  autoLogoutTimeoutMinutes: number;
  setAutoLogoutTimeoutMinutes: (mins: number) => void;
  staffUsers: User[];
  rolePermissions: Record<Role, Permission[]>;
  login: (req: LoginRequest) => Promise<void>;
  loginWithBiometrics: (req: BiometricLoginRequest) => Promise<WebAuthnVerificationResult>;
  issueWebAuthnChallenge: (targetUser?: { id?: string; email?: string }) => WebAuthnChallengeRecord;
  verifyWebAuthnChallengeResponse: (
    assertion: WebAuthnAssertionPayload,
    expectedUserEmail?: string,
  ) => Promise<WebAuthnVerificationResult>;
  logout: () => Promise<void>;
  switchStore: (store: Store) => void;
  updateStoreProfile: (updates: Partial<Store>) => void;
  switchCurrency: (currencyCode: string) => void;
  switchDemoRole: (role: Role) => void;
  can: (permission: Permission) => boolean;
  lockSystem: () => void;
  unlockSystem: (pinOrPassword: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  setInactivityTimeoutMinutes: (mins: number) => void;
  addStaffUser: (payload: AddStaffPayload) => User;
  updateStaffUser: (id: string, updates: Partial<User> & { pin?: string }) => void;
  deleteStaffUser: (id: string) => boolean;
  switchActiveUser: (userOrId: User | string) => void;
  updateRolePermissions: (role: Role, perms: Permission[]) => void;
  resetRolePermissions: () => void;
  getStaffPin: (userId: string) => string;
  setStaffPin: (userId: string, pin: string) => void;
  assignRoleToStaffUser: (
    id: string,
    newRole: Role,
    options?: {
      permissions?: Permission[];
      assignedBy?: string;
      note?: string;
      permissionSetId?: string;
    },
  ) => void;
  bulkAssignRoles: (
    ids: string[],
    newRole: Role,
    options?: { assignedBy?: string; note?: string },
  ) => void;
  customPermissionSets: CustomPermissionSet[];
  addCustomPermissionSet: (
    set: Omit<CustomPermissionSet, 'id' | 'createdAt' | 'updatedAt'>,
  ) => CustomPermissionSet;
  updateCustomPermissionSet: (id: string, updates: Partial<CustomPermissionSet>) => void;
  deleteCustomPermissionSet: (id: string) => boolean;
  applyPermissionSetToRole: (setId: string, role: Role) => void;
  applyPermissionSetToStaff: (setId: string, staffId: string) => void;
  resetPermissionSetsToDefaults: () => void;
  forgotPin: (identity: string, org: string, store: string, reg: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = AUTH_SESSION_STORAGE_KEY;
const TIMEOUT_STORAGE_KEY = 'prodx_pos_inactivity_timeout';
const CUSTOM_STORE_KEY = 'prodx_custom_store_profile';
const IS_DEVELOPMENT = shouldReadMock();

function applyOperationalScopeToSession(
  baseSession: SessionContext,
  scope: OperationalScope | null,
): SessionContext {
  if (!scope) return baseSession;
  const updatedStore: Store = {
    ...baseSession.currentStore,
    organizationId: scope.organizationId || baseSession.currentStore.organizationId,
    code: scope.branchName || baseSession.currentStore.code,
    name: scope.branchAddress
      ? `${scope.branchName} — ${scope.branchAddress}`
      : scope.branchName || baseSession.currentStore.name,
    address: scope.branchAddress || baseSession.currentStore.address,
  };

  const storesList: Store[] = baseSession.organization.stores.some(
    (s) => s.code.toLowerCase() === updatedStore.code.toLowerCase(),
  )
    ? baseSession.organization.stores.map((s) =>
        s.code.toLowerCase() === updatedStore.code.toLowerCase() ? updatedStore : s,
      )
    : [updatedStore, ...baseSession.organization.stores];

  const updatedOrg: Organization = {
    ...baseSession.organization,
    id: scope.organizationId || baseSession.organization.id,
    name: scope.organizationName || baseSession.organization.name,
    slug: scope.organizationSlug || baseSession.organization.slug,
    stores: storesList,
  };

  return {
    ...baseSession,
    organization: updatedOrg,
    currentStore: updatedStore,
    registerId: scope.terminalCode || baseSession.registerId,
    operationalScope: scope,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionContext | null>(null);
  const [operationalScope, setOperationalScopeState] = useState<OperationalScope | null>(() =>
    getStoredOperationalScope(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [staffUsers, setStaffUsers] = useState<User[]>(() =>
    IS_DEVELOPMENT ? getStoredStaffDirectory() : [],
  );
  const [rolePermissions, setRolePermissions] = useState<Record<Role, Permission[]>>(() =>
    IS_DEVELOPMENT
      ? getStoredRolePermissions()
      : {
          admin: [...ROLE_PERMISSIONS.admin],
          manager: [...ROLE_PERMISSIONS.manager],
          cashier: [...ROLE_PERMISSIONS.cashier],
        },
  );
  const [staffPins, setStaffPins] = useState<Record<string, string>>(() =>
    IS_DEVELOPMENT ? getStoredStaffPins() : {},
  );
  const [customPermissionSets, setCustomPermissionSets] = useState<CustomPermissionSet[]>(() =>
    IS_DEVELOPMENT ? getStoredCustomPermissionSets() : [],
  );
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutesState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(TIMEOUT_STORAGE_KEY);
      if (stored !== null) return Number(stored);
    } catch {}
    return 5;
  });
  const [autoLogoutTimeoutMinutes, setAutoLogoutTimeoutMinutesState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('prodx_pos_auto_logout_timeout');
      if (stored !== null) return Number(stored);
    } catch {}
    return 30;
  });

  const setAutoLogoutTimeoutMinutes = (mins: number) => {
    setAutoLogoutTimeoutMinutesState(mins);
    try {
      localStorage.setItem('prodx_pos_auto_logout_timeout', String(mins));
    } catch {}
  };
  const lastActivityRef = useRef(Date.now());
  const webAuthnChallengesRef = useRef<Map<string, WebAuthnChallengeRecord>>(new Map());

  /**
   * Issues a cryptographically random, single-use WebAuthn challenge with a 60-second TTL.
   */
  const issueWebAuthnChallenge = useCallback(
    (targetUser?: { id?: string; email?: string }): WebAuthnChallengeRecord => {
      const now = Date.now();
      // Prune expired challenges
      for (const [id, rec] of webAuthnChallengesRef.current.entries()) {
        if (now > rec.expiresAt || rec.used) {
          webAuthnChallengesRef.current.delete(id);
        }
      }

      const challengeRecord = createWebAuthnChallengeRecord(targetUser, 60_000);
      webAuthnChallengesRef.current.set(challengeRecord.challengeId, challengeRecord);

      auditService.logDiagnosticEvent({
        category: 'system',
        level: 'DEBUG',
        event: 'AUTH_WEBAUTHN_CHALLENGE_ISSUED',
        message: `Issued WebAuthn challenge ${challengeRecord.challengeId} for biometric verification`,
        metadata: {
          challengeId: challengeRecord.challengeId,
          rpId: challengeRecord.rpId,
          origin: challengeRecord.origin,
          expiresAt: new Date(challengeRecord.expiresAt).toISOString(),
          targetUserEmail: targetUser?.email || 'discoverable',
        },
      });

      return challengeRecord;
    },
    [],
  );

  /**
   * Verifies a WebAuthn challenge-response assertion (FIDO2 Relying Party verification):
   * 1. Single-use & TTL validation of the issued cryptographic challenge
   * 2. clientDataJSON type ('webauthn.get'), challenge nonce, and origin binding check
   * 3. authenticatorData binary structure (>= 37 bytes), User Present (UP) & User Verified (UV) flags
   * 4. Registered passkey lookup & anti-cloning signature counter progression
   */
  const verifyWebAuthnChallengeResponse = useCallback(
    async (
      assertion: WebAuthnAssertionPayload,
      expectedUserEmail?: string,
    ): Promise<WebAuthnVerificationResult> => {
      const fail = (error: string): WebAuthnVerificationResult => {
        auditService.logDiagnosticEvent({
          category: 'system',
          level: 'ERROR',
          event: 'AUTH_WEBAUTHN_VERIFICATION_FAILED',
          message: `WebAuthn challenge-response verification failed: ${error}`,
          metadata: {
            challengeId: assertion?.challengeId,
            credentialId: assertion?.credentialId,
            expectedUserEmail,
          },
        });
        return { verified: false, error };
      };

      if (
        !assertion ||
        !assertion.challengeId ||
        !assertion.credentialId ||
        !assertion.clientDataJSON ||
        !assertion.authenticatorData ||
        !assertion.signature
      ) {
        return fail('Incomplete WebAuthn assertion payload.');
      }

      const challengeRecord = webAuthnChallengesRef.current.get(assertion.challengeId);
      if (!challengeRecord) {
        return fail('WebAuthn challenge not found or already consumed (replay prevented).');
      }

      // Immediately mark challenge as consumed to guarantee single-use idempotency
      if (challengeRecord.used) {
        webAuthnChallengesRef.current.delete(assertion.challengeId);
        return fail('WebAuthn challenge was already used.');
      }
      challengeRecord.used = true;
      webAuthnChallengesRef.current.delete(assertion.challengeId);

      if (Date.now() > challengeRecord.expiresAt) {
        return fail('WebAuthn challenge expired. Please scan your fingerprint or face again.');
      }

      // Verify clientDataJSON
      let parsedClientData: {
        type?: string;
        challenge?: string;
        origin?: string;
      };
      try {
        const rawJson = base64URLToString(assertion.clientDataJSON);
        parsedClientData = JSON.parse(rawJson);
      } catch {
        return fail('Malformed WebAuthn clientDataJSON.');
      }

      if (parsedClientData.type !== 'webauthn.get') {
        return fail(`Invalid WebAuthn ceremony type: "${parsedClientData.type}". Expected "webauthn.get".`);
      }

      if (parsedClientData.challenge !== challengeRecord.challenge) {
        return fail('WebAuthn cryptographic challenge mismatch.');
      }

      if (parsedClientData.origin && parsedClientData.origin !== challengeRecord.origin) {
        return fail(`WebAuthn origin mismatch: expected "${challengeRecord.origin}".`);
      }

      // Verify authenticatorData binary flags & signCount
      let authDataBytes: Uint8Array;
      try {
        authDataBytes = base64URLToBuffer(assertion.authenticatorData);
      } catch {
        return fail('Invalid WebAuthn authenticatorData encoding.');
      }

      if (authDataBytes.byteLength < 37) {
        return fail('Invalid WebAuthn authenticatorData length (< 37 bytes).');
      }

      const flags = authDataBytes[32];
      const userPresent = (flags & 0x01) !== 0; // Bit 0: UP
      const userVerified = (flags & 0x04) !== 0; // Bit 2: UV

      if (!userPresent) {
        return fail('WebAuthn User Presence (UP) flag was not asserted by authenticator.');
      }

      const dataView = new DataView(
        authDataBytes.buffer,
        authDataBytes.byteOffset,
        authDataBytes.byteLength,
      );
      const assertionSignCount = dataView.getUint32(33, false);

      // Match against registered staff passkeys
      const passkeys = getRegisteredPasskeys();
      const matchedCredential = passkeys.find((k) => k.id === assertion.credentialId);
      if (!matchedCredential) {
        return fail('Passkey credential is not registered on this POS terminal.');
      }

      const targetEmail = expectedUserEmail || challengeRecord.targetUserEmail;
      if (
        targetEmail &&
        matchedCredential.userEmail.toLowerCase() !== targetEmail.trim().toLowerCase()
      ) {
        return fail('Biometric credential user does not match requested staff identity.');
      }

      // Clone detection: if authenticator reports a non-zero signCount, it must not regress
      if (assertionSignCount > 0 && assertionSignCount < matchedCredential.counter) {
        return fail('WebAuthn signature counter regression detected (potential cloned credential).');
      }

      const updatedCounter = Math.max((matchedCredential.counter || 0) + 1, assertionSignCount);
      matchedCredential.counter = updatedCounter;
      matchedCredential.lastUsedAt = new Date().toISOString();
      saveRegisteredPasskeys(passkeys);

      auditService.logDiagnosticEvent({
        category: 'system',
        level: 'DEBUG',
        event: 'AUTH_WEBAUTHN_ASSERTION_VERIFIED',
        message: `Verified WebAuthn challenge-response for ${matchedCredential.userEmail}`,
        metadata: {
          challengeId: challengeRecord.challengeId,
          credentialId: matchedCredential.id,
          userEmail: matchedCredential.userEmail,
          authenticatorType: matchedCredential.authenticatorType,
          authMethod: assertion.authMethod,
          userPresent,
          userVerified,
          signCount: updatedCounter,
          origin: challengeRecord.origin,
          rpId: challengeRecord.rpId,
        },
      });

      return {
        verified: true,
        credential: matchedCredential,
        challengeId: challengeRecord.challengeId,
        signCount: updatedCounter,
        userPresent,
        userVerified,
        origin: challengeRecord.origin,
        rpId: challengeRecord.rpId,
        authMethod: assertion.authMethod,
      };
    },
    [],
  );

  const setOperationalScope = useCallback((scope: OperationalScope | null) => {
    setOperationalScopeState(scope);
    saveStoredOperationalScope(scope);
    if (scope) {
      setSession((prev) => (prev ? applyOperationalScopeToSession(prev, scope) : null));
    }
  }, []);


  useEffect(() => {
    async function restoreSession() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        const persisted = readPersistedSession(sessionStorage);
        if (!persisted) {
          clearPersistedSession(sessionStorage);
          return;
        }
        const verified = await authApi.verifySession(persisted.token);
        if (!verified) {
          clearPersistedSession(sessionStorage);
          return;
        }
        const storedScope = verified.operationalScope ?? getStoredOperationalScope();
        if (storedScope) {
          setOperationalScopeState(storedScope);
          saveStoredOperationalScope(storedScope);
        }
        const scopedSession = applyOperationalScopeToSession(verified, storedScope);
        setSession(scopedSession);
        writePersistedSession(sessionStorage, scopedSession.token);
        lastActivityRef.current = Date.now();
      } catch (err) {
        console.error('[AuthContext] Session restore error:', err);
        try {
          clearPersistedSession(sessionStorage);
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      } finally {
        setIsLoading(false);
      }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    if (!session) return;
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    const timer = setInterval(() => {
      if (!session) return;
      const idleMs = Date.now() - lastActivityRef.current;

      // 1. Check Auto-Logout Timeout
      if (
        autoLogoutTimeoutMinutes > 0 &&
        idleMs >= autoLogoutTimeoutMinutes * 60 * 1000
      ) {
        console.warn(`[AuthContext] POS session auto-terminated due to ${autoLogoutTimeoutMinutes}m inactivity.`);
        auditService.logDiagnosticEvent({
          category: 'system',
          level: 'WARN',
          event: 'AUTH_AUTO_LOGOUT_INACTIVITY',
          message: `Session auto-logged out due to ${autoLogoutTimeoutMinutes} minutes of inactivity.`,
          metadata: { userId: session.currentUser.id, autoLogoutTimeoutMinutes },
        });
        void logout();
        return;
      }

      // 2. Check Auto-Lock Timeout
      if (
        !isLocked &&
        inactivityTimeoutMinutes > 0 &&
        idleMs >= inactivityTimeoutMinutes * 60 * 1000
      ) {
        setIsLocked(true);
      }
    }, 10000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handleActivity));
      clearInterval(timer);
    };
  }, [session, isLocked, inactivityTimeoutMinutes, autoLogoutTimeoutMinutes]);

  useEffect(() => {
    aiService.setSessionToken(session?.token);
  }, [session?.token]);

  const login = async (req: LoginRequest) => {
    setIsLoading(true);
    const traceId = `auth-login-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Diagnostic logging wrapper
    const logTrace = (stage: string, data?: any) => {
      const payload = {
        traceId,
        stage,
        timestamp: new Date().toISOString(),
        // Never persist credentials or direct identifiers in diagnostic logs.
        request: createAuthDiagnosticRequest(req),
        ...data,
      };

      console.log(`%c[AUTH_CONTEXT][${stage}]`, 'color: #0ea5e9; font-weight: bold;', payload);

      auditService.logDiagnosticEvent({
        category: 'system',
        level: stage === 'ERROR' ? 'ERROR' : 'DEBUG',
        event: `AUTH_CONTEXT_LOGIN_${stage}`,
        message: `Tracing login stage: ${stage}`,
        metadata: payload,
      });
    };

    logTrace('START');

    // Authentication credentials must never be written to console or audit logs.

    try {
      const effectiveScope = req.organizationContext ?? operationalScope ?? undefined;
      const enrichedReq: LoginRequest = effectiveScope
        ? {
            ...req,
            organizationSlug: effectiveScope.organizationSlug || req.organizationSlug,
            storeCode: effectiveScope.branchCode || effectiveScope.branchName || req.storeCode,
            registerId: effectiveScope.terminalCode || req.registerId,
            organizationContext: effectiveScope,
          }
        : req;

      logTrace('ENRICHED', {
        effectiveScope,
        enrichedMapping: {
          organization: {
            fromId: effectiveScope?.organizationId,
            toSlug: enrichedReq.organizationSlug,
          },
          branch: {
            fromId: effectiveScope?.branchId,
            fromName: effectiveScope?.branchName,
            fromCode: effectiveScope?.branchCode,
            toStoreCode: enrichedReq.storeCode,
          },
          terminal: {
            fromId: effectiveScope?.terminalId,
            fromCode: effectiveScope?.terminalCode,
            toRegisterId: enrichedReq.registerId,
          }
        },
      });

      if (enrichedReq.storeCode.includes(' ')) {
        console.warn('%c[AUTH_WARNING] storeCode contains spaces. This often happens if the Branch Name is sent instead of the Branch Code.', 'color: #ef4444; font-weight: bold;');
      }

      const scopeValidation = await validateOrgBranchTerminalBatch(
        enrichedReq.organizationSlug,
        enrichedReq.storeCode,
        enrichedReq.registerId,
      );

      if (!scopeValidation.isValid) {
        logTrace('ERROR_SCOPE_LINKAGE', { error: scopeValidation.error });
        throw new Error(scopeValidation.error || 'Organization, Branch, or Terminal scope linkage validation failed against Firestore.');
      }

      logTrace('SCOPE_LINKAGE_VERIFIED', {
        org: scopeValidation.organization?.name,
        branch: scopeValidation.branch?.name,
        terminal: scopeValidation.terminal?.name,
      });

      // Verify WebAuthn challenge-response if authenticating via biometric assertion
      if (enrichedReq.webAuthnAssertion) {
        const verification = await verifyWebAuthnChallengeResponse(
          enrichedReq.webAuthnAssertion,
          enrichedReq.emailOrPin,
        );
        if (!verification.verified || !verification.credential) {
          logTrace('ERROR_WEBAUTHN_VERIFICATION', { error: verification.error });
          throw new Error(verification.error || 'WebAuthn challenge-response verification failed.');
        }
        enrichedReq.emailOrPin = verification.credential.userEmail;
        enrichedReq.passwordOrPin = `WEBAUTHN_VERIFIED:${verification.credential.id}:${verification.challengeId}`;
        enrichedReq.biometricVerified = true;
        logTrace('WEBAUTHN_CHALLENGE_RESPONSE_VERIFIED', {
          challengeId: verification.challengeId,
          credentialId: verification.credential.id,
          signCount: verification.signCount,
          userPresent: verification.userPresent,
          userVerified: verification.userVerified,
          authMethod: verification.authMethod,
        });
      }

      const rawSession = await authApi.login(enrichedReq);
      
      logTrace('SUCCESS_API', {
        userId: rawSession.currentUser.id,
        role: rawSession.currentUser.role,
      });

      if (effectiveScope) {
        setOperationalScopeState(effectiveScope);
        saveStoredOperationalScope(effectiveScope);
      }
      const newSession = applyOperationalScopeToSession(
        rawSession,
        effectiveScope ?? rawSession.operationalScope ?? null,
      );

      try {
        writePersistedSession(sessionStorage, newSession.token);
      } catch (error) {
        logTrace('ERROR_PERSIST', { error: String(error) });
        await authApi.logout(newSession.token).catch(() => undefined);
        throw error;
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setSession(newSession);
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      logTrace('COMPLETE');
    } catch (err) {
      logTrace('ERROR', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Executes the full WebAuthn Biometric Challenge-Response login flow:
   * 1. Issues a single-use cryptographic challenge in AuthContext
   * 2. Requests fingerprint / facial recognition assertion from the authenticator
   * 3. Verifies clientDataJSON, authenticatorData (UP/UV flags, signCount), and scope linkage
   * 4. Establishes the authenticated POS session
   */
  const loginWithBiometrics = async (
    biometricReq: BiometricLoginRequest,
  ): Promise<WebAuthnVerificationResult> => {
    const challengeRecord = issueWebAuthnChallenge(biometricReq.targetUser);

    const authResult = await authenticatePasskey(biometricReq.targetUser, challengeRecord);
    if (!authResult.success || !authResult.credential || !authResult.assertion) {
      throw new Error(
        authResult.error || 'Biometric fingerprint / facial recognition verification failed.',
      );
    }

    const verification = await verifyWebAuthnChallengeResponse(
      authResult.assertion,
      authResult.credential.userEmail,
    );

    if (!verification.verified || !verification.credential) {
      throw new Error(
        verification.error || 'WebAuthn challenge-response verification failed.',
      );
    }

    await login({
      organizationSlug: biometricReq.organizationSlug,
      storeCode: biometricReq.storeCode,
      registerId: biometricReq.registerId,
      emailOrPin: verification.credential.userEmail,
      passwordOrPin: `WEBAUTHN_VERIFIED:${verification.credential.id}:${verification.challengeId}`,
      organizationContext: biometricReq.organizationContext,
      requireAdminRole: biometricReq.requireAdminRole,
      biometricVerified: true,
    });

    return verification;
  };

  const logout = async () => {
    const token = session?.token;
    setIsLoading(true);
    try {
      if (token) await authApi.logout(token);
    } catch (error) {
      console.error('[AuthContext] Server logout failed; local session was cleared.', error);
    } finally {
      setSession(null);
      setIsLocked(false);
      try {
        clearPersistedSession(sessionStorage);
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!session || IS_DEVELOPMENT) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiry)) {
      void logout();
      return;
    }

    const attemptRenewal = async (): Promise<void> => {
      if (disposed) return;
      if (expiry - Date.now() <= 0) {
        await logout();
        return;
      }

      try {
        const renewed = await authApi.renewSession(session.token);
        if (disposed) return;
        if (renewed) {
          setSession((current) => current?.token === session.token
            ? applyOperationalScopeToSession(renewed, current.operationalScope ?? null)
            : current);
          return;
        }
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status?: unknown }).status
          : undefined;
        if (status === 401 || status === 403) {
          await logout();
          return;
        }
        console.warn(
          '[AuthContext] POS session renewal failed; retrying only while the current session remains valid.',
          error instanceof Error ? error.message : 'unknown error',
        );
      }

      if (disposed) return;
      const remaining = expiry - Date.now();
      if (remaining <= 0) {
        await logout();
        return;
      }
      timer = setTimeout(() => { void attemptRenewal(); }, Math.min(30_000, Math.max(1_000, remaining - 500)));
    };

    timer = setTimeout(() => { void attemptRenewal(); }, Math.max(0, expiry - Date.now() - 60_000));
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [session?.token, session?.expiresAt]);

  const switchStore = (store: Store) => {
    if (!IS_DEVELOPMENT || !session) return;
    const updatedScope: OperationalScope | undefined = session.operationalScope
      ? {
          ...session.operationalScope,
          branchId: store.id,
          branchName: store.code,
          branchAddress: store.address,
        }
      : undefined;
    if (updatedScope) {
      setOperationalScopeState(updatedScope);
      saveStoredOperationalScope(updatedScope);
    }
    const updated: SessionContext = {
      ...session,
      currentStore: store,
      operationalScope: updatedScope ?? session.operationalScope,
    };
    setSession(updated);
  };

  const updateStoreProfile = (updates: Partial<Store>) => {
    if (!IS_DEVELOPMENT || !session) return;
    const updatedStore = { ...session.currentStore, ...updates };
    const updatedSession = { ...session, currentStore: updatedStore };
    setSession(updatedSession);
    localStorage.setItem(CUSTOM_STORE_KEY, JSON.stringify(updatedStore));
  };

  const switchCurrency = (currencyCode: string) => {
    if (!IS_DEVELOPMENT || !session) return;
    const updatedStore = { ...session.currentStore, currency: currencyCode.toUpperCase() };
    const updated = { ...session, currentStore: updatedStore };
    setSession(updated);
  };

  const switchDemoRole = (_role: Role) => {
    return;
  };

  const can = (permission: Permission) =>
    session?.currentUser.permissions.includes(permission) ?? false;

  const lockSystem = () => {
    if (session) setIsLocked(true);
  };

  const unlockSystem = async (pinOrPassword: string) => {
    if (!session) return false;
    const secret = pinOrPassword;
    if (!secret) return false;
    if (IS_DEVELOPMENT) {
      const normalizedPin = secret.trim();
      const userPin = getStaffPin(session.currentUser.id);
      if (!userPin || normalizedPin !== userPin) return false;
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    }
    let replacement: SessionContext | null = null;
    try {
      const previousSession = session;
      const activeScope = previousSession.operationalScope ?? operationalScope ?? undefined;
      replacement = await authApi.login({
        organizationSlug: previousSession.organization.slug,
        storeCode: previousSession.currentStore.code,
        registerId: previousSession.registerId,
        emailOrPin: previousSession.currentUser.email,
        passwordOrPin: secret,
        organizationContext: activeScope,
      });
      if (
        replacement.currentUser.id !== previousSession.currentUser.id ||
        replacement.currentStore.id !== previousSession.currentStore.id ||
        replacement.registerId !== previousSession.registerId
      ) {
        await authApi.logout(replacement.token).catch(() => undefined);
        return false;
      }
      try {
        await authApi.logout(previousSession.token);
      } catch {
        await authApi.logout(replacement.token).catch(() => undefined);
        return false;
      }
      const scopedReplacement = applyOperationalScopeToSession(replacement, activeScope ?? null);
      writePersistedSession(sessionStorage, scopedReplacement.token);
      setSession(scopedReplacement);
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    } catch {
      if (replacement) await authApi.logout(replacement.token).catch(() => undefined);
      return false;
    }
  };

  /**
   * Unlocks a locked POS terminal using WebAuthn fingerprint or facial recognition
   * verified via challenge-response against the active session user.
   */
  const unlockWithBiometrics = async (): Promise<boolean> => {
    if (!session) return false;
    try {
      const challengeRecord = issueWebAuthnChallenge({
        id: session.currentUser.id,
        email: session.currentUser.email,
      });
      const authResult = await authenticatePasskey(
        {
          id: session.currentUser.id,
          email: session.currentUser.email,
          name: session.currentUser.name,
        },
        challengeRecord,
      );
      if (!authResult.success || !authResult.assertion) return false;

      const verification = await verifyWebAuthnChallengeResponse(
        authResult.assertion,
        session.currentUser.email,
      );
      if (!verification.verified) return false;

      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    } catch {
      return false;
    }
  };

  const setInactivityTimeoutMinutes = (mins: number) => {
    setInactivityTimeoutMinutesState(mins);
    try {
      localStorage.setItem(TIMEOUT_STORAGE_KEY, String(mins));
    } catch {}
  };

  const addStaffUser = (payload: AddStaffPayload): User => {
    if (!IS_DEVELOPMENT) throw new Error('Staff management requires the production server API.');
    const id = `usr-${payload.role}-${Date.now().toString(36)}`;
    const rolePerms = rolePermissions[payload.role] || [];
    const newUser: User = {
      id,
      name: payload.name.trim(),
      email: payload.email.trim(),
      role: payload.role,
      employeeCode: payload.employeeCode.trim().toUpperCase(),
      permissions: rolePerms,
      isActive: payload.isActive !== false,
    };
    const nextUsers = [...staffUsers, newUser];
    setStaffUsers(nextUsers);
    saveStoredStaffDirectory(nextUsers);
    if (payload.pin) setStaffPin(id, payload.pin);
    return newUser;
  };

  const updateStaffUser = (id: string, updates: Partial<User> & { pin?: string }) => {
    if (!IS_DEVELOPMENT) return;
    const nextUsers = staffUsers.map((u) =>
      u.id === id
        ? {
            ...u,
            ...updates,
            role: updates.role || u.role,
            permissions:
              updates.permissions || (updates.role ? rolePermissions[updates.role] : u.permissions),
          }
        : u,
    );
    setStaffUsers(nextUsers);
    saveStoredStaffDirectory(nextUsers);
    if (updates.pin) setStaffPin(id, updates.pin);
    if (session?.currentUser.id === id) {
      const updatedUser = nextUsers.find((u) => u.id === id);
      if (updatedUser) {
        const updatedSession = { ...session, currentUser: updatedUser };
        setSession(updatedSession);
      }
    }
  };

  const assignRoleToStaffUser = (
    id: string,
    newRole: Role,
    options?: {
      permissions?: Permission[];
      assignedBy?: string;
      note?: string;
      permissionSetId?: string;
    },
  ) =>
    updateStaffUser(id, {
      role: newRole,
      permissions: [
        ...(options?.permissions || rolePermissions[newRole] || ROLE_PERMISSIONS[newRole]),
      ],
      lastRoleAssignedAt: new Date().toISOString(),
      assignedBy: options?.assignedBy || session?.currentUser.name,
      roleAssignmentNote: options?.note,
      assignedPermissionSetId: options?.permissionSetId,
    });

  const bulkAssignRoles = (
    ids: string[],
    newRole: Role,
    options?: { assignedBy?: string; note?: string },
  ) => {
    if (!IS_DEVELOPMENT) return;
    const nextPerms = rolePermissions[newRole] || ROLE_PERMISSIONS[newRole];
    const now = new Date().toISOString();
    const assignedBy = options?.assignedBy || session?.currentUser.name;
    const nextUsers = staffUsers.map((u) =>
      ids.includes(u.id)
        ? {
            ...u,
            role: newRole,
            permissions: [...nextPerms],
            lastRoleAssignedAt: now,
            assignedBy,
            roleAssignmentNote: options?.note,
          }
        : u,
    );
    setStaffUsers(nextUsers);
    saveStoredStaffDirectory(nextUsers);
    if (session && ids.includes(session.currentUser.id)) {
      const updatedUser = nextUsers.find((u) => u.id === session.currentUser.id);
      if (updatedUser) {
        const updatedSession = { ...session, currentUser: updatedUser };
        setSession(updatedSession);
      }
    }
  };

  const deleteStaffUser = (id: string) => {
    if (!IS_DEVELOPMENT || session?.currentUser.id === id) return false;
    const nextUsers = staffUsers.filter((u) => u.id !== id);
    setStaffUsers(nextUsers);
    saveStoredStaffDirectory(nextUsers);
    return true;
  };

  const switchActiveUser = (userOrId: User | string) => {
    if (!IS_DEVELOPMENT || !session) return;
    const target =
      typeof userOrId === 'string' ? staffUsers.find((u) => u.id === userOrId) : userOrId;
    if (!target) return;
    const updatedUser = {
      ...target,
      permissions: rolePermissions[target.role] || target.permissions,
    };
    const updatedSession = { ...session, currentUser: updatedUser };
    setSession(updatedSession);
    writePersistedSession(sessionStorage, updatedSession.token);
  };

  const updateRolePermissions = (role: Role, perms: Permission[]) => {
    if (!IS_DEVELOPMENT) return;
    const nextMatrix = { ...rolePermissions, [role]: perms };
    setRolePermissions(nextMatrix);
    saveStoredRolePermissions(nextMatrix);
    if (session?.currentUser.role === role) {
      const updatedSession = {
        ...session,
        currentUser: { ...session.currentUser, permissions: perms },
      };
      setSession(updatedSession);
      writePersistedSession(sessionStorage, updatedSession.token);
    }
  };

  const resetRolePermissions = () => {
    if (!IS_DEVELOPMENT) return;
    const defaults = {
      admin: [...ROLE_PERMISSIONS.admin],
      manager: [...ROLE_PERMISSIONS.manager],
      cashier: [...ROLE_PERMISSIONS.cashier],
    };
    setRolePermissions(defaults);
    saveStoredRolePermissions(defaults);
    if (session) {
      const updatedSession = {
        ...session,
        currentUser: { ...session.currentUser, permissions: defaults[session.currentUser.role] },
      };
      setSession(updatedSession);
      writePersistedSession(sessionStorage, updatedSession.token);
    }
  };

  const getStaffPin = (userId: string) => (IS_DEVELOPMENT ? staffPins[userId] || '' : '');

  const setStaffPin = (userId: string, pin: string) => {
    if (!IS_DEVELOPMENT) return;
    const nextPins = { ...staffPins, [userId]: pin.trim() };
    setStaffPins(nextPins);
    saveStoredStaffPins(nextPins);
  };

  const addCustomPermissionSet = (
    setPayload: Omit<CustomPermissionSet, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    if (!IS_DEVELOPMENT)
      throw new Error('Permission management requires the production server API.');
    const id = `pset-custom-${Date.now()}`;
    const now = new Date().toISOString();
    const newSet = { ...setPayload, id, createdAt: now, updatedAt: now };
    const next = [...customPermissionSets, newSet];
    setCustomPermissionSets(next);
    saveStoredCustomPermissionSets(next);
    return newSet;
  };

  const updateCustomPermissionSet = (id: string, updates: Partial<CustomPermissionSet>) => {
    if (!IS_DEVELOPMENT) return;
    const next = customPermissionSets.map((s) =>
      s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s,
    );
    setCustomPermissionSets(next);
    saveStoredCustomPermissionSets(next);
  };

  const deleteCustomPermissionSet = (id: string) => {
    if (!IS_DEVELOPMENT) return false;
    const target = customPermissionSets.find((s) => s.id === id);
    if (!target || target.isSystem) return false;
    const next = customPermissionSets.filter((s) => s.id !== id);
    setCustomPermissionSets(next);
    saveStoredCustomPermissionSets(next);
    return true;
  };

  const applyPermissionSetToRole = (setId: string, role: Role) => {
    const set = customPermissionSets.find((s) => s.id === setId);
    if (set) updateRolePermissions(role, set.permissions);
  };

  const applyPermissionSetToStaff = (setId: string, staffId: string) => {
    const set = customPermissionSets.find((s) => s.id === setId);
    if (!set) return;
    const assigned = (set.assignedStaffIds || []).includes(staffId);
    setCustomPermissionSets((prev) => {
      const next = prev.map((s) =>
        s.id === setId
          ? {
              ...s,
              assignedStaffIds: assigned
                ? (s.assignedStaffIds || []).filter((id) => id !== staffId)
                : [...(s.assignedStaffIds || []), staffId],
            }
          : s,
      );
      saveStoredCustomPermissionSets(next);
      return next;
    });
    updateStaffUser(staffId, { permissions: assigned ? [] : [...set.permissions] });
  };

  const resetPermissionSetsToDefaults = () => {
    if (!IS_DEVELOPMENT) return;
    setCustomPermissionSets(DEFAULT_PERMISSION_SETS);
    saveStoredCustomPermissionSets(DEFAULT_PERMISSION_SETS);
  };

  const forgotPin = async (identity: string, org: string, store: string, reg: string) => {
    await authApi.forgotPin(org, store, identity, reg);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        operationalScope,
        setOperationalScope,
        isLoading,
        isLocked,
        inactivityTimeoutMinutes,
        autoLogoutTimeoutMinutes,
        setAutoLogoutTimeoutMinutes,
        staffUsers,
        rolePermissions,
        login,
        loginWithBiometrics,
        issueWebAuthnChallenge,
        verifyWebAuthnChallengeResponse,
        logout,
        switchStore,
        updateStoreProfile,
        switchCurrency,
        switchDemoRole,
        can,
        lockSystem,
        unlockSystem,
        unlockWithBiometrics,
        setInactivityTimeoutMinutes,
        addStaffUser,
        updateStaffUser,
        deleteStaffUser,
        switchActiveUser,
        updateRolePermissions,
        resetRolePermissions,
        getStaffPin,
        setStaffPin,
        assignRoleToStaffUser,
        bulkAssignRoles,
        customPermissionSets,
        addCustomPermissionSet,
        updateCustomPermissionSet,
        deleteCustomPermissionSet,
        applyPermissionSetToRole,
        applyPermissionSetToStaff,
        resetPermissionSetsToDefaults,
        forgotPin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useOptionalAuth(): AuthContextType | null {
  return useContext(AuthContext) || null;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  return {
    session: null,
    operationalScope: null,
    setOperationalScope: () => {},
    isLoading: false,
    isLocked: false,
    inactivityTimeoutMinutes: 15,
    autoLogoutTimeoutMinutes: 30,
    setAutoLogoutTimeoutMinutes: () => {},
    staffUsers: [],
    rolePermissions: ROLE_PERMISSIONS as Record<Role, Permission[]>,
    login: async () => {},
    loginWithBiometrics: async () => ({ verified: false }),
    issueWebAuthnChallenge: () => createWebAuthnChallengeRecord(),
    verifyWebAuthnChallengeResponse: async () => ({ verified: false }),
    logout: async () => {},
    switchStore: () => {},
    switchCurrency: () => {},
    switchDemoRole: () => {},
    switchActiveUser: () => {},
    lockSystem: () => {},
    unlockSystem: async () => false,
    unlockWithBiometrics: async () => false,
    setInactivityTimeoutMinutes: () => {},
    can: () => false,
    addStaffUser: () => ({} as User),
    updateStaffUser: () => {},
    deleteStaffUser: () => false,
    updateRolePermissions: () => {},
    resetRolePermissions: () => {},
    getStaffPin: () => '',
    setStaffPin: () => {},
    assignRoleToStaffUser: () => {},
    bulkAssignRoles: () => {},
    customPermissionSets: [],
    addCustomPermissionSet: () => ({} as CustomPermissionSet),
    updateCustomPermissionSet: () => {},
    deleteCustomPermissionSet: () => false,
    updateStoreProfile: () => {},
    applyPermissionSetToRole: () => {},
    applyPermissionSetToStaff: () => {},
    resetPermissionSetsToDefaults: () => {},
    forgotPin: async () => {},
  };
}
