import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

interface ClientErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface ClientErrorBoundaryState {
  failed: boolean;
}

export class ClientErrorBoundary extends Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ClientErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CH Ultimate renderer stopped unexpectedly.', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="client-crash-screen">
        <section role="alert">
          <span>CH ULTIMATE / PEMULIHAN</span>
          <h1>Aplikasi tidak dapat ditampilkan</h1>
          <p>Data perangkat tidak dihapus. Muat ulang koneksi aplikasi untuk mencoba kembali.</p>
          <button type="button" onClick={this.props.onRetry}>Coba lagi</button>
        </section>
      </main>
    );
  }
}
