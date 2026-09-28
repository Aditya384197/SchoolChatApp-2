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
  window.visualViewport?.addEventListener('scroll', sync, { passive: true });
  // In edge-to-edge mode, opening/closing the keyboard doesn't reliably fire
  // a plain `resize` event on every Android/WebView combination, and it can
  // fire late. Focus/blur on any text field is a far more deterministic
  // signal that the keyboard is about to show or hide, so resync repeatedly
  // right around that moment too (covers both the fast and the slow cases).
  const onFocusChange = () => { sync(); [30, 80, 150, 250, 400, 600].forEach(ms => window.setTimeout(sync, ms)); };
  document.addEventListener('focusin', onFocusChange, true);
  document.addEventListener('focusout', onFocusChange, true);
  // Belt-and-suspenders: while a text field is focused, also poll briefly --
  // some keyboards animate open/closed over ~300-400ms, and a single
  // snapshot can land mid-animation and undershoot the real height.
  let pollTimer = null;
  document.addEventListener('focusin', e => {
    if (!/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) return;
    clearInterval(pollTimer);
    let ticks = 0;
    pollTimer = window.setInterval(() => { sync(); if (++ticks > 10) clearInterval(pollTimer); }, 80);
  }, true);
  document.addEventListener('focusout', () => { clearInterval(pollTimer); }, true);
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
