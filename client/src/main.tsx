import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
