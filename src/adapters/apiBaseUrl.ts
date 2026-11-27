/**
 * Accept absolute HTTP(S) API URLs and root-relative same-origin paths.
 * Protocol-relative URLs are deliberately rejected because they can change origin.
 */
export const isProductionApiBaseUrl = (value: string): boolean => {
  const candidate = value.trim();
  if (!candidate || /[\\\\\u0000-\u001f\u007f]/.test(candidate)) return false;

  if (candidate.startsWith('/')) {
    return !candidate.startsWith('//') && !candidate.includes('?') && !candidate.includes('#');
  }

  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};


/**
 * Resolve an optional production API origin. An empty value deliberately means
 * same-origin routing (for example, Vercel rewrites); invalid non-empty values
 * fail closed instead of silently falling back to local/mock policy.
 */
export const resolveProductionApiBaseUrl = (value?: string): string => {
  const candidate = value?.trim() ?? '';
  if (!candidate) return '';
  if (!isProductionApiBaseUrl(candidate)) {
    throw new Error('Production API base URL must be a same-origin path or an absolute HTTP(S) URL.');
  }
  return candidate.replace(/\/$/, '');
};
