import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="panel mx-auto mt-10 max-w-md p-8 text-center">
        <p className="mb-2 font-semibold text-white">This section ran into a problem.</p>
        <p className="mb-5 text-sm text-zinc-400">Your data is safe. Reload the page or switch to another section.</p>
        <button onClick={() => window.location.reload()} className="btn btn-primary">
          Reload
        </button>
      </div>
    );
  }
}
