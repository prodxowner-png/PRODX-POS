export const isMockDisabled = (): boolean =>
  typeof localStorage !== 'undefined' && localStorage.getItem('prodx_disable_mocks') === 'true';

const isViteDevelopmentBuild = (): boolean =>
  typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true;

export const hasProductionApiRoute = (flags: {
  isDev: boolean;
  isPreview: boolean;
  mocksDisabled: boolean;
}): boolean => flags.mocksDisabled || (!flags.isDev && !flags.isPreview);

export const hasProductionUrl = (): boolean => hasProductionApiRoute({
  isDev: isViteDevelopmentBuild(),
  isPreview: isAiStudioPreview(),
  mocksDisabled: isMockDisabled(),
});

export const isAiStudioPreview = (): boolean => {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h.includes('aistudio.google.com') || 
         h.includes('asia-southeast1.run.app') || 
         h.includes('localhost');
};

export const shouldUseDevelopmentMocks = (flags: {
  isDev: boolean;
  isPreview: boolean;
  mocksDisabled: boolean;
}): boolean => !flags.mocksDisabled && (flags.isDev || flags.isPreview);

export const isDevelopmentMode = (): boolean => shouldUseDevelopmentMocks({
  isDev: isViteDevelopmentBuild(),
  isPreview: isAiStudioPreview(),
  mocksDisabled: isMockDisabled(),
});

export const shouldReadMock = (): boolean => isDevelopmentMode();
