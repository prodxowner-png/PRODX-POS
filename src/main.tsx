import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './i18n';
import App from './App.tsx';
import './index.css';
import './premium-design-system.css';
import { registerSW } from 'virtual:pwa-register';
import { SpeedInsights } from '@vercel/speed-insights/react';

const updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW: (swUrl, registration) => {
    if (!registration) return;

    void registration.update();

    const refresh = async () => {
      if (!navigator.onLine || registration.installing) return;

      try {
        const response = await fetch(swUrl, {
          cache: 'no-store',
          headers: {
            'cache-control': 'no-cache',
          },
        });

        if (response.ok) {
          await registration.update();
        }
      } catch {
        // Offline or transient network failure: keep the current service worker.
      }
    };

    void refresh();
  },
});

void updateServiceWorker;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <SpeedInsights />
  </StrictMode>,
);
