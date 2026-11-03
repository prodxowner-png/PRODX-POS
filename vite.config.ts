import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, splitVendorChunkPlugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import compression from 'vite-plugin-compression';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(() => {
  const diagnosticsDir = path.resolve(process.cwd(), '.private-build/diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  return {
    plugins: [
      react(), 
      tailwindcss(),
      splitVendorChunkPlugin(),
      visualizer({
        filename: '.private-build/diagnostics/stats.html',
        open: false,
        gzipSize: true,
        brotliSize: true,
      }),
      compression({
        algorithm: 'gzip',
        ext: '.gz',
        threshold: 10240,
        deleteOriginFile: false,
      }),
      compression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 10240,
        deleteOriginFile: false,
      }),
      {
        name: 'prodx-metafile-reporter',
        writeBundle(options, bundle) {
          const metafile: {
            timestamp: string;
            chunks: Record<string, {
              size: number;
              codeSize: number;
              isEntry: boolean;
              isDynamicEntry: boolean;
              modules: Record<string, { size: number }>;
              imports: string[];
              exports: string[];
            }>;
            assets: Record<string, { size: number }>;
            summary: {
              totalChunks: number;
              totalAssets: number;
              totalSizeKb: number;
            };
          } = {
            timestamp: new Date().toISOString(),
            chunks: {},
            assets: {},
            summary: {
              totalChunks: 0,
              totalAssets: 0,
              totalSizeKb: 0,
            },
          };

          let totalBytes = 0;

          for (const [fileName, output] of Object.entries(bundle)) {
            if (output.type === 'chunk') {
              metafile.summary.totalChunks++;
              const moduleMap: Record<string, { size: number }> = {};
              for (const [modId, modInfo] of Object.entries(output.modules)) {
                moduleMap[modId] = {
                  size: (modInfo as any).code?.length || 0,
                };
              }
              metafile.chunks[fileName] = {
                size: output.code.length,
                codeSize: output.code.length,
                isEntry: output.isEntry,
                isDynamicEntry: output.isDynamicEntry,
                modules: moduleMap,
                imports: output.imports,
                exports: output.exports,
              };
              totalBytes += output.code.length;
            } else {
              metafile.summary.totalAssets++;
              metafile.assets[fileName] = {
                size: (output.source as string)?.length || 0,
              };
              totalBytes += (output.source as string)?.length || 0;
            }
          }

          metafile.summary.totalSizeKb = Math.round(totalBytes / 1024 * 100) / 100;

          const outDir = path.resolve(process.cwd(), '.private-build/diagnostics');
          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
          }
          fs.writeFileSync(
            path.resolve(outDir, 'metafile.json'),
            JSON.stringify(metafile, null, 2),
            'utf-8'
          );
          console.log(`[PRODX Metafile Reporter] Generated private build metafile report at ${outDir}/metafile.json`);
        },
      },
      {
        name: 'prodx-disable-hmr-ws',
        enforce: 'post',
        transform(code, id) {
          if (id.includes('vite/dist/client/client.mjs')) {
            return code.replace(
              /createConnection:\s*\(\)\s*=>\s*new WebSocket\([\s\S]*?"vite-hmr"\s*\)/g,
              `createConnection: () => ({
                readyState: 1,
                OPEN: 1,
                CONNECTING: 0,
                CLOSING: 2,
                CLOSED: 3,
                url: 'ws://localhost:3000/',
                protocol: 'vite-hmr',
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent() { return true; },
                send() {},
                close() {}
              })`
            );
          }
          return null;
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'prodx-logo.svg', 'prodx-pos-logo.svg', 'prodx-pos-receipt-logo.svg'],
        manifest: {
          id: '/',
          name: 'PRODX POS',
          short_name: 'PRODXPOS',
          description: 'Premium Point of Sale system with complete offline resilience.',
          theme_color: '#FF6A00',
          background_color: '#0B0D11',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/favicon.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/favicon.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'maskable',
            }
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10000000,
          skipWaiting: true,
          clientsClaim: true,
          navigateFallbackDenylist: [/^\/$/],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'prodx-navigation-cache',
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    preview: {
      host: '0.0.0.0',
      allowedHosts: [
        'healthcheck.railway.app',
        'prodx-pos-test-production.up.railway.app',
      ],
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
          passes: 2,
          global_defs: {
            'process.env.NODE_ENV': '"production"',
          },
        },
        format: {
          comments: false,
        },
        mangle: {
          safari10: true,
        },
      },
      cssMinify: true,
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      reportCompressedSize: false,
      emptyOutDir: true,
      cacheDir: 'node_modules/.vite',
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Match package path segments, not arbitrary substrings such as "react-router"
            // or transitive packages that can create circular manual chunk dependencies.
            if (!id.includes('node_modules')) return;
            if (/(?:^|[\\/])node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
            if (/(?:^|[\\/])node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons';
            if (/(?:^|[\\/])node_modules[\\/](?:firebase|@firebase[\\/][^\\/]+|@supabase[\\/][^\\/]+)(?:[\\/]|$)/.test(id)) return 'vendor-firebase';
            if (/(?:^|[\\/])node_modules[\\/](?:framer-motion|motion|recharts|d3-[^\\/]+)[\\/]/.test(id)) return 'vendor-ui-extra';
            if (/(?:^|[\\/])node_modules[\\/](?:jspdf|html2canvas|@dnd-kit[\\/][^\\/]+|i18next|react-i18next)[\\/]/.test(id)) return 'vendor-utils';
            // Let Rollup place all remaining dependencies automatically to avoid a catch-all chunk cycle.
            return;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
