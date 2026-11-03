/**
 * PRODX POS — Gmail Workspace Integration.
 * Uses Google Identity Services directly; Firebase Auth is not required.
 */

export interface GmailUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentityServices {
  oauth2: {
    initTokenClient(options: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: { type?: string; message?: string }) => void;
    }): GoogleTokenClient;
    revoke(token: string, callback?: () => void): void;
  };
}

declare global {
  interface Window {
    google?: { accounts?: GoogleIdentityServices };
  }
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

let cachedAccessToken: string | null = null;
let tokenClient: GoogleTokenClient | null = null;
let cachedUser: GmailUser | null = null;
let scriptPromise: Promise<void> | null = null;

const googleClientId = (): string => {
  const id = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!id) throw new Error('Gmail integration is not configured: VITE_GOOGLE_OAUTH_CLIENT_ID is missing.');
  return id;
};

async function ensureGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Gmail sign-in is only available in a browser.');
  }
  if (window.google?.accounts?.oauth2) return;
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => window.google?.accounts?.oauth2
        ? resolve()
        : reject(new Error('Google Identity Services loaded without OAuth support.'));
      script.onerror = () => reject(new Error('Could not load Google Identity Services.'));
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  await scriptPromise;
}

export const initGmailAuth = (
  onAuthSuccess?: (user: GmailUser, token: string) => void,
  onAuthFailure?: () => void,
): (() => void) => {
  if (cachedAccessToken && cachedUser) onAuthSuccess?.(cachedUser, cachedAccessToken);
  else onAuthFailure?.();
  return () => undefined;
};

export const signInWithGmail = async (): Promise<{ user: GmailUser; accessToken: string }> => {
  await ensureGoogleIdentityServices();
  const clientId = googleClientId();
  const googleOAuth = window.google?.accounts?.oauth2;
  if (!googleOAuth) throw new Error('Google OAuth is unavailable.');
  return new Promise((resolve, reject) => {
    tokenClient = googleOAuth.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPES,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google did not return a Gmail access token.'));
          return;
        }
        cachedAccessToken = response.access_token;
        cachedUser = { uid: 'google-oauth-session', email: null, displayName: 'Google account' };
        resolve({ user: cachedUser, accessToken: response.access_token });
      },
      error_callback: (error) => reject(new Error(error.message || 'Google OAuth popup failed.')),
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

export const getGmailAccessToken = (): string | null => cachedAccessToken;

export const signOutGmail = async (): Promise<void> => {
  const token = cachedAccessToken;
  cachedAccessToken = null;
  cachedUser = null;
  if (!token || typeof window === 'undefined') return;
  await ensureGoogleIdentityServices();
  window.google?.accounts?.oauth2.revoke(token, () => undefined);
};

// Helper to encode email in base64url format required by Gmail API
function createEmailMessage(to: string, subject: string, bodyText: string): string {
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    bodyText,
  ];
  const email = emailLines.join('\r\n');
  return btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendGmailMessage(accessToken: string, to: string, subject: string, body: string) {
  const rawMessage = createEmailMessage(to, subject, body);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawMessage }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to send email via Gmail API (${response.status})`);
  }

  return response.json();
}

export async function listGmailMessages(accessToken: string, maxResults = 10) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list Gmail messages (${response.status})`);
  }

  return response.json();
}
