import type { RequestHandler } from 'express';

/**
 * Deny build-analysis artifacts before any static directory is served.
 * Diagnostics may be emitted under build/diagnostics, and server.ts can use
 * build/ as a production fallback when dist/ is absent.
 */
export const privateBuildArtifactGuard: RequestHandler = (request, response, next) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.path).toLowerCase();
  } catch {
    response.status(400).set('Cache-Control', 'no-store').end();
    return;
  }

  const segments = pathname.split('/').filter(Boolean);
  const basename = segments.at(-1);
  const isDiagnosticsPath = segments.includes('diagnostics');
  const isBuildReport = basename === 'stats.html' || basename === 'metafile.json';
  const isPrivateServerBundle = basename === 'server-bundle.js';

  if (isDiagnosticsPath || isBuildReport || isPrivateServerBundle) {
    response.status(404).set('Cache-Control', 'no-store').end();
    return;
  }

  next();
};
