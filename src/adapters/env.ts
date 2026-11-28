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

export const isAiStudioPreviewHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === 'aistudio.google.com' ||
  hostname.endsWith('.aistudio.google.com');

export const isAiStudioPreview = (): boolean =>
  typeof window !== 'undefined' && isAiStudioPreviewHostname(window.location.hostname);

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
