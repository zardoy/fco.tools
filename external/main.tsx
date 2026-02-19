import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './converter.jsx';
import { getFormatCacheJSON } from './conversionService.ts';

// Expose for buildCache.js (puppeteer) when using external/main.tsx as entry
if (typeof window !== 'undefined') {
  (window as unknown as { printSupportedFormatCache: () => string }).printSupportedFormatCache = getFormatCacheJSON;
}

// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────

interface ErrorBoundaryState { error: Error | null; }

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[FCO.TOOLS ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#07080F', color: '#E8E8FF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Space Grotesk','Segoe UI',sans-serif", padding: 24,
        }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#FF6B9D', marginBottom: 8 }}>
              Something went wrong
            </h2>
            <pre style={{
              fontSize: 11, color: '#ffffff33', fontFamily: "'JetBrains Mono',monospace",
              background: '#0C0D1A', border: '1px solid #ffffff0a', borderRadius: 10,
              padding: 14, textAlign: 'left', overflowX: 'auto', marginBottom: 20,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                background: 'linear-gradient(135deg,#FF6B9D,#C77DFF)', border: 'none',
                borderRadius: 12, padding: '10px 28px', fontSize: 14, fontWeight: 700,
                color: '#07080F', cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── PWA SERVICE WORKER ───────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/convert/sw.js').catch(err => {
      console.warn('[FCO.TOOLS] SW registration failed:', err);
    });
  });
}

// ─── MOUNT ────────────────────────────────────────────────────────────────────

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
