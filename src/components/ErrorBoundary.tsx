import React from "react";

// Without a boundary, one exception while drawing a plan unmounts the whole page, and with it
// the plan the run just produced. Wrapped around the plan views, the rest of the app - and the
// profile in its state - survives, and the reader sees what failed instead of a blank page.

interface Props {
  /** Change it (e.g. to a new plan's identity) to retry rendering after a failure. */
  resetKey?: unknown;
  fallback: (error: Error, retry: () => void) => React.ReactNode;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("A plan view failed to render:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return this.props.children;
  }
}

/**
 * A boundary only catches errors thrown while rendering components below it. JSX written inline
 * in a parent's render is evaluated by the parent, so wrapping it in a boundary does nothing;
 * passing it here as a function moves that evaluation into this child.
 */
export function RenderBelow({ children }: { children: () => React.ReactNode }) {
  return <>{children()}</>;
}

/** The fallback the plan views use: the error, and where the plan is. */
export function PlanRenderError({ error, retry, draftSaved }: { error: Error; retry: () => void; draftSaved: boolean }) {
  return (
    <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-5 space-y-3 text-sm text-rose-900">
      <p className="font-bold">This part of the plan could not be displayed.</p>
      <p className="text-rose-800">
        {draftSaved
          ? "The plan itself is safe: it was saved and is in the Saved tab."
          : "The plan is still loaded. Use Save Profile to keep it before leaving the page."}
      </p>
      <pre className="text-[11px] bg-white/70 border border-rose-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{error.message}</pre>
      <button type="button" onClick={retry} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer">
        Try again
      </button>
    </div>
  );
}
