import crypto from 'node:crypto';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const DEFAULT_TIMEOUT_MS = 2500;

export type PasswordCompromiseCheck = {
  compromised: boolean;
  count: number;
};

export class PasswordCompromiseCheckUnavailable extends Error {
  constructor() {
    super('Compromised-password screening service is unavailable.');
    this.name = 'PasswordCompromiseCheckUnavailable';
  }
}

export const checkPasswordCompromise = async (
  password: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PasswordCompromiseCheck> => {
  if (!password) return { compromised: false, count: 0 };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const signal = AbortSignal.timeout(Math.max(0, timeoutMs));
  try {
    const response = await fetchImpl(HIBP_RANGE_URL + prefix, {
      method: 'GET',
      headers: {
        'user-agent': 'PRODX-POS/1.0 password-security',
        'add-padding': 'true',
      },
      signal,
    });
    if (!response.ok) throw new PasswordCompromiseCheckUnavailable();

    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [returnedSuffix, countText] = line.trim().split(':');
      if (returnedSuffix?.toUpperCase() !== suffix) continue;
      const count = Number.parseInt(countText ?? '0', 10);
      return { compromised: Number.isFinite(count) && count > 0, count: Number.isFinite(count) ? count : 0 };
    }
    return { compromised: false, count: 0 };
  } catch (error) {
    if (error instanceof PasswordCompromiseCheckUnavailable) throw error;
    throw new PasswordCompromiseCheckUnavailable();
  }
};
