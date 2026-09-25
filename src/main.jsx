import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { PrefsProvider } from './context/Prefs.jsx';
import { registerPlugin } from '@capacitor/core';

const SystemBars = registerPlugin('SystemBars');

async function syncSystemInsets() {
  let native = {};
  try { native = await SystemBars.getInsets(); } catch {}

  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  const systemTop = Math.max(0, Number(native?.top) || 0) / dpr;
  const systemBottom = Math.max(0, Number(native?.bottom) || 0) / dpr;
  const nativeIme = Math.max(0, Number(native?.imeBottom) || 0) / dpr;

  let keyboardDelta = 0;
  try {
    const vv = window.visualViewport;
    if (vv && window.innerHeight) {
      keyboardDelta = Math.max(0, window.innerHeight - vv.height - systemBottom);
    }
  } catch {}

  // Depending on Android/WebView generation, either the layout viewport
  // resizes or only the IME inset changes. Keep whichever measurement is
  // larger, while always preserving the 3-button/gesture navigation area.
  const bottomSafe = Math.max(systemBottom, nativeIme, systemBottom + keyboardDelta);
  const root = document.documentElement;
  root.style.setProperty('--sc-system-top', `${systemTop}px`);
  root.style.setProperty('--sc-system-bottom', `${systemBottom}px`);
  root.style.setProperty('--sc-bottom-safe', `${bottomSafe}px`);
}

if (typeof window !== 'undefined') {
  const sync = () => { syncSystemInsets().catch(() => {}); };
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });
  window.visualViewport?.addEventListener('resize', sync, { passive: true });
  sync();
  window.setTimeout(sync, 120);
  window.setTimeout(sync, 450);
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </ErrorBoundary>
);
