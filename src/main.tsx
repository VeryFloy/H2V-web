import { render } from 'solid-js/web';
import { ErrorBoundary } from 'solid-js';
import App from './App';
import { i18n } from './stores/i18n.store';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element found');

render(() => (
  <ErrorBoundary fallback={(err) => (
    <div style={{ padding: '2rem', color: '#fff', 'text-align': 'center', 'font-family': 'system-ui' }}>
      <h2>{i18n.t('error.generic')}</h2>
      <p style={{ opacity: '0.7' }}>{err?.message ?? 'Unknown error'}</p>
      <button
        style={{ padding: '0.5rem 1.5rem', 'margin-top': '1rem', cursor: 'pointer', background: '#7c5cfc', border: 'none', color: '#fff', 'border-radius': '8px' }}
        onClick={() => window.location.reload()}
      >
        {i18n.t('app.reload')}
      </button>
    </div>
  )}>
    <App />
  </ErrorBoundary>
), root);
