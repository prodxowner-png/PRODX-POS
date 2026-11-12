/**
 * PRODX POS — Gmail Workspace Integration.
 * Uses Google Identity Services directly; Firebase Auth is not required.
 */

export interface GmailUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};
type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};
type GoogleOAuth2 = {
  initTokenClient: (options: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GoogleTokenClient;
  revoke: (token: string, callback?: () => void) => void;
};
type GoogleIdentity = { accounts: { oauth2: GoogleOAuth2 } };
type GmailServiceDependencies = {
  getClientId?: () => string | undefined;
  loadGoogleIdentity?: () => Promise<GoogleIdentity>;
  fetcher?: typeof fetch;
};

type GmailAuthListener = (user: GmailUser | null, token: string | null) => void;

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

const defaultClientId = () => import.meta.env?.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined;

const loadGoogleIdentityScript = async (): Promise<GoogleIdentity> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Google Gmail sign-in is available only in a browser.');
  }
  const existing = (window as Window & { google?: GoogleIdentity }).google;
  if (existing?.accounts?.oauth2) return existing;

  await new Promise<void>((resolve, reject) => {
    const current = document.querySelector<HTMLScriptElement>('script[data-prodx-google-identity]');
    if (current) {
      current.addEventListener('load', () => resolve(), { once: true });
      current.addEventListener('error', () => {
        current.remove();
        reject(new Error('Failed to load Google Identity Services.'));
      }, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.prodxGoogleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to load Google Identity Services.'));
    };
    document.head.appendChild(script);
  });

  const googleIdentity = (window as Window & { google?: GoogleIdentity }).google;
  if (!googleIdentity?.accounts?.oauth2) throw new Error('Google Identity Services did not initialize.');
  return googleIdentity;
};

export const createGmailService = ({
  getClientId = defaultClientId,
  loadGoogleIdentity = loadGoogleIdentityScript,
  fetcher = fetch,
}: GmailServiceDependencies = {}) => {
  let cachedAccessToken: string | null = null;
  let cachedUser: GmailUser | null = null;
  const listeners = new Set<GmailAuthListener>();

  const notify = () => {
    listeners.forEach((listener) => {
      try { listener(cachedUser, cachedAccessToken); } catch (error) {
        console.error('[GmailIntegration] Auth listener failed:', error);
      }
    });
  };

  const requireClientId = () => {
    const clientId = getClientId();
    if (!clientId) throw new Error('Gmail OAuth is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID to an approved Google OAuth web client ID.');
    return clientId;
  };

  const initGmailAuth = (
    onAuthSuccess?: (user: GmailUser, token: string) => void,
    onAuthFailure?: () => void,
  ) => {
    const listener: GmailAuthListener = (user, token) => {
      if (user && token) onAuthSuccess?.(user, token);
      else onAuthFailure?.();
    };
    listeners.add(listener);
    listener(cachedUser, cachedAccessToken);
    return () => { listeners.delete(listener); };
  };

  const signInWithGmail = async (): Promise<{ user: GmailUser; accessToken: string }> => {
    const clientId = requireClientId();
    const google = await loadGoogleIdentity();
    const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GMAIL_SCOPES,
        callback: resolve,
        error_callback: (error) => reject(new Error(error.message || error.type || 'Google OAuth failed.')),
      });
      client.requestAccessToken({ prompt: 'consent' });
    });
    if (!response.access_token) {
      throw new Error(response.error_description || response.error || 'Google OAuth did not return an access token.');
    }

    // Gmail users.getProfile is authorized by gmail.metadata/readonly
    const profileResponse = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${response.access_token}` },
    });
    if (!profileResponse.ok) throw new Error(`Failed to load Google account profile (${profileResponse.status}).`);
    const profile = await profileResponse.json() as { emailAddress?: string };
    const emailAddress = profile.emailAddress?.trim();
    if (!emailAddress) throw new Error('Gmail profile response did not contain an email address.');

    cachedAccessToken = response.access_token;
    cachedUser = {
      uid: emailAddress,
      email: emailAddress,
      displayName: null,
      photoURL: null,
    };
    notify();
    return { user: cachedUser, accessToken: cachedAccessToken };
  };

  const getGmailAccessToken = () => cachedAccessToken;

  const signOutGmail = async () => {
    const token = cachedAccessToken;
    cachedAccessToken = null;
    cachedUser = null;
    notify();
    if (!token) return;
    const google = await loadGoogleIdentity();
    await new Promise<void>((resolve) => google.accounts.oauth2.revoke(token, resolve));
  };

  const sendGmailMessage = async (accessToken: string, to: string, subject: string, body: string) => {
    // Prevent CR/LF header injection
    const cleanTo = to.replace(/[\r\n]/g, '');
    const cleanSubject = subject.replace(/[\r\n]/g, '');
    
    // RFC 2047 encode subject (e.g. for Thai characters)
    const encodedSubject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(cleanSubject)))}?=`;

    const emailLines = [
      `To: ${cleanTo}`,
      `Subject: ${encodedSubject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const rawMessage = btoa(unescape(encodeURIComponent(emailLines.join('\r\n'))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const response = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawMessage }),
    });
    if (response.status === 401) await signOutGmail();
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(errorData.error?.message || `Failed to send email via Gmail API (${response.status})`);
    }
    return response.json();
  };

  const listGmailMessages = async (accessToken: string, maxResults = 10) => {
    const safeMaxResults = Number.isInteger(maxResults) ? Math.min(50, Math.max(1, maxResults)) : 10;
    const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${safeMaxResults}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) await signOutGmail();
    if (!response.ok) throw new Error(`Failed to list Gmail messages (${response.status})`);
    return response.json() as Promise<{ messages?: Array<Record<string, unknown>> }>;
  };

  return { initGmailAuth, signInWithGmail, getGmailAccessToken, signOutGmail, sendGmailMessage, listGmailMessages };
};

const gmailService = createGmailService();
export const initGmailAuth = gmailService.initGmailAuth;
export const signInWithGmail = gmailService.signInWithGmail;
export const getGmailAccessToken = gmailService.getGmailAccessToken;
export const signOutGmail = gmailService.signOutGmail;
export const sendGmailMessage = gmailService.sendGmailMessage;
export const listGmailMessages = gmailService.listGmailMessages;
