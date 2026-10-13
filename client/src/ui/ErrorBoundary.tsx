import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Evita la pantalla en blanco: muestra el error si algo falla al renderizar. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[UI] error de render', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h2>Algo ha fallado</h2>
          <pre>{String(this.state.error.stack || this.state.error.message)}</pre>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
