import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from '../i18n';

const PrefsContext = createContext(null);

// Languages shown in Settings (each name is written in its own script).
export const LANGUAGES = [
  { code: 'hi', label: 'हिंदी', locale: 'hi-IN' },
  { code: 'en', label: 'English', locale: 'en-IN' },
  { code: 'te', label: 'తెలుగు', locale: 'te-IN' },
  { code: 'mr', label: 'मराठी', locale: 'mr-IN' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', locale: 'pa-IN' },
];

export function localeFor(lang) {
  return LANGUAGES.find(l => l.code === lang)?.locale || 'hi-IN';
}

function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

// The app theme is fully independent from the phone's theme: whatever the
// user picks here (Light / Dark) always wins. Only "System default" follows
// the phone. We always write an explicit data-theme + color-scheme, so the
// WebView can never force-darken a page the user set to Light.
function applyTheme(theme) {
  const effective = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.setAttribute('data-theme', effective);
  root.style.colorScheme = effective === 'dark' ? 'dark' : 'only light';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? 'dark' : 'only light');
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', effective === 'dark' ? '#0f172a' : '#0f6fe8'));
}

export function PrefsProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem('schoolChatLang') || 'en';
    return translations[saved] ? saved : 'en';
  });
  const [theme, setThemeState] = useState(() => localStorage.getItem('schoolChatTheme') || 'system');
  const [background, setBackgroundState] = useState(() => localStorage.getItem('schoolChatBackground') || 'none');

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    let mq;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return undefined; }
    const onChange = () => applyTheme('system');
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener?.(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', onChange); else mq.removeListener?.(onChange); };
  }, [theme]);

  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  function setLang(next) { setLangState(next); localStorage.setItem('schoolChatLang', next); }
  function setTheme(next) { setThemeState(next); localStorage.setItem('schoolChatTheme', next); }
  function setBackground(next) { setBackgroundState(next); localStorage.setItem('schoolChatBackground', next); }

  const dict = translations[lang] || translations.en;
  const t = (key) => dict[key] || translations.en[key] || translations.hi[key] || key;

  return (
    <PrefsContext.Provider value={{ lang, setLang, theme, setTheme, background, setBackground, t }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
