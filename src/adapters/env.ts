export const isMockDisabled = (): boolean => 
  typeof localStorage !== 'undefined' && localStorage.getItem('prodx_disable_mocks') === 'true';

import { isProductionApiBaseUrl } from './apiBaseUrl';

export const hasProductionUrl = (): boolean => {
  const url = import.meta.env.VITE_AUTH_API_BASE_URL?.trim() || '';
  return isProductionApiBaseUrl(url);
};

export const isAiStudioPreview = (): boolean => {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h.includes('aistudio.google.com') || 
         h.includes('asia-southeast1.run.app') || 
         h.includes('localhost');
};

export const shouldReadMock = (): boolean => {
  if (isMockDisabled()) return false;
  return import.meta.env.DEV || !hasProductionUrl() || isAiStudioPreview();
};
