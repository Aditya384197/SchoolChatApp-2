import React from 'react';

// Last-resort safety net: without this, any render-time exception in the
// Capacitor WebView just leaves a permanent blank white screen with nothing
// visible and nothing in the UI to explain why -- exactly the "app doesn't
// open at all" symptom. This guarantees something readable shows up instead.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24,
          fontFamily: 'sans-serif', textAlign: 'center', background: '#fff7ed', color: '#7c2d12'
        }}>
          <h2 style={{ margin: '0 0 8px' }}>कुछ गलत हो गया</h2>
          <p style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.6 }}>
            ऐप लोड होते वक्त एक एरर आया। नीचे का मैसेज डेवलपर को भेजें:
          </p>
          <pre style={{
            maxWidth: '90vw', overflow: 'auto', background: '#fff', border: '1px solid #fed7aa',
            borderRadius: 8, padding: 12, fontSize: 12, textAlign: 'left'
          }}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
