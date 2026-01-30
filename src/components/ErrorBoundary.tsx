import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    try {
      const details = {
        name: error?.name,
        message: error?.message,
        stack: (error as any)?.stack,
        componentStack: errorInfo?.componentStack,
        ts: new Date().toISOString()
      };
      console.error('[corepms][error-boundary]', details);
    } catch {
      console.error('Uncaught error:', error, errorInfo);
    }
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || 'Something went wrong';
      const message = this.props.fallbackMessage || 'An unexpected error occurred. Please try reloading the application.';
      const componentStack = this.state.errorInfo?.componentStack || '';
      const copy = async () => {
        const payload = JSON.stringify({
          name: this.state.error?.name,
          message: this.state.error?.message,
          stack: (this.state.error as any)?.stack,
          componentStack
        }, null, 2);
        try { await navigator.clipboard.writeText(payload); } catch {}
      };
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">{title}</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            {this.state.error && (
              <div className="bg-gray-100 p-4 rounded text-left text-xs font-mono mb-6 overflow-auto max-h-48">
                {this.state.error.toString()}
              </div>
            )}
            {componentStack && (
              <div className="bg-gray-100 p-2 rounded text-left text-[10px] font-mono mb-4 overflow-auto max-h-32">
                {componentStack}
              </div>
            )}
            <div className="flex gap-4 justify-center">
              <Button onClick={this.handleReload}>Reload Application</Button>
              <Button variant="outline" onClick={() => this.setState({ hasError: false })}>
                Try Again
              </Button>
              <Button variant="outline" onClick={copy}>Copy Details</Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
