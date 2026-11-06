/**
 * Accept absolute HTTP(S) API URLs and root-relative same-origin paths.
 * Protocol-relative URLs are deliberately rejected because they can change origin.
 */
export const isProductionApiBaseUrl = (value: string): boolean => {
  const candidate = value.trim();
  if (!candidate || /[\\\\\u0000-\u001f\u007f]/.test(candidate)) return false;

  if (candidate.startsWith('/')) {
    return !candidate.startsWith('//');
  }

  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
};
