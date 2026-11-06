/**
 * Accept absolute HTTP(S) API URLs and root-relative same-origin paths.
 * Protocol-relative URLs are deliberately rejected because they can change origin.
 */
export const isProductionApiBaseUrl = (value: string): boolean => {
  const url = value.trim();
  return url.startsWith('http') || (url.startsWith('/') && !url.startsWith('//'));
};
