import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from '../i18n';

const PrefsContext = createContext(null);

export function PrefsProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('schoolChatLang') || 'en');
  const [theme, setThemeState] = useState(() => localStorage.getItem('schoolChatTheme') || 'system');

  useEffect(() => {
    const root = document.documentElement;
    function apply() {
      if (theme === 'system') {
        root.removeAttribute('data-theme'); // CSS media query decides
      } else {
        root.setAttribute('data-theme', theme);
      }
    }
    apply();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      // no-op listener just to keep this effect re-run-safe; the CSS media
      // query handles the actual switch live on its own.
      return () => {};
    }
    return undefined;
  }, [theme]);

  function setLang(next) { setLangState(next); localStorage.setItem('schoolChatLang', next); }
  function setTheme(next) { setThemeState(next); localStorage.setItem('schoolChatTheme', next); }

  const dict = translations[lang] || translations.hi;
  const t = (key) => dict[key] || translations.hi[key] || key;

  return (
    <PrefsContext.Provider value={{ lang, setLang, theme, setTheme, t }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
