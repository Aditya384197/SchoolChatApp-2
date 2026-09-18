import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { PrefsProvider } from './context/Prefs.jsx';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </ErrorBoundary>
);
