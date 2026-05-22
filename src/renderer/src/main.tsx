import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmProvider } from './components/ConfirmDialog';
import './styles.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }
  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-2xl rounded-lg border border-danger-100 bg-danger-50 p-6">
            <div className="mb-2 text-base font-medium text-danger-600">渲染出错</div>
            <pre className="overflow-auto whitespace-pre-wrap text-xs text-danger-600">
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
            <button
              onClick={() => location.reload()}
              className="mt-3 rounded bg-danger-100 px-3 py-1 text-xs text-danger-600 hover:bg-danger-100/70"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
