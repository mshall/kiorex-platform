import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./states";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    return this.state.error ? <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12"><ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} /></main> : this.props.children;
  }
}
