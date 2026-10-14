import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { initAnalytics } from './analytics';

// Before the first render, so the identity and screen effects have a tag to report to.
initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last resort: the plan views have their own boundaries that keep the workspace alive.
        Anything that still reaches here says what failed instead of leaving a blank page. */}
    <ErrorBoundary
      fallback={(error) => (
        <div role="alert" style={{ maxWidth: 640, margin: '64px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>The app hit an error and could not continue.</h1>
          <p style={{ color: '#475569' }}>Finished plans are auto-saved as drafts; reload and open the Saved tab to find the latest run.</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff1f2', padding: 12, borderRadius: 8, fontSize: 12 }}>{error.message}</pre>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '6px 12px' }}>Reload</button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
