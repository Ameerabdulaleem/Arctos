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
      <div role="alert" className="p-10 text-center">
        <p className="text-white font-semibold mb-2">This section ran into a problem.</p>
        <p className="text-zinc-400 text-sm mb-4">Your data is safe. Reload the page or switch to another section.</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
          Reload
        </button>
      </div>
    );
  }
}
