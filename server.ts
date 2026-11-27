import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'path';
import { createProductionApp } from './server/entrypoint.ts';
import { privateBuildArtifactGuard } from './server/http/private-build-artifact-guard.ts';
import { logger, safeErrorDiagnostic } from './server/observability/logger.ts';
import { installGracefulShutdown } from './server/observability/shutdown.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);

  // Create the production Express app (the backend)
  const { app: backendApp, pool } = await createProductionApp();

  const app = express();

  if (!isProd) {
    // Load Vite dynamically so --omit=dev production installs do not require vite at runtime.
    const { createServer: createViteServer } = await import('vite');
    // Create Vite server in middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'custom',
    });

    app.use(backendApp);
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const fs = await import('node:fs/promises');
        const html = await fs.readFile(resolve(__dirname, 'index.html'), 'utf-8');
        const template = await vite.transformIndexHtml(url, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    // Production mode: Resolve static assets path dynamically
    // Handle both dist and build directories
    const fs = await import('node:fs');
    let distPath = resolve(__dirname, 'dist');
    
    if (!fs.existsSync(distPath)) {
      distPath = resolve(__dirname, 'build');
    }
    
    if (!fs.existsSync(distPath)) {
      if (fs.existsSync(resolve(__dirname, 'index.html'))) {
        distPath = __dirname;
      }
    }

    app.use(backendApp);
    // Must run before express.static: distPath may fall back to build/ or the repository root.
    app.use(privateBuildArtifactGuard);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(resolve(distPath, 'index.html'));
    });
  }

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info('server.started', { host: '0.0.0.0', port, mode: isProd ? 'production' : 'development' });
  });

  installGracefulShutdown({ server, pool });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn('server.port_in_use_retrying', { port, code: 'EADDRINUSE' });
      setTimeout(() => {
        server.close();
        server.listen(port, '0.0.0.0');
      }, 1000);
    } else {
      logger.error('server.error', safeErrorDiagnostic(err));
    }
  });
}

startServer().catch((err) => {
  logger.error('server.startup_failed', safeErrorDiagnostic(err));
  process.exit(1);
});
