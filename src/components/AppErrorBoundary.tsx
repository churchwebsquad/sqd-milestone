/**
 * Top-level React error boundary. Catches any render-phase exception
 * thrown anywhere in the app and displays a usable error UI instead
 * of the default React behavior (unmount the whole tree → blank page).
 *
 * The boundary is mounted at App.tsx as the outermost wrapper so it
 * catches errors from every route, modal, and async state update.
 *
 * Why this matters: prior to this, a single `undefined.split()` (or
 * any other render-time throw) inside a deeply-nested component would
 * blank the entire app, with no on-screen indication of what failed.
 * Users would just see white, the only clue was the browser console.
 *
 * Now: any thrown error shows the message + stack + a "Reload" button.
 * In dev the stack is full; in production the message is shown and
 * the stack is gated behind a details disclosure (since prod stacks
 * reference minified line numbers anyway).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Surface to the console for source-mapped stack in dev tools.
    console.error('[AppErrorBoundary] caught:', error)
    console.error('[AppErrorBoundary] component stack:', errorInfo.componentStack)
    this.setState({ errorInfo })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleReset = (): void => {
    this.setState({ error: null, errorInfo: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    const error = this.state.error

    return (
      <div className="min-h-screen bg-cream text-deep-plum px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-[11px] uppercase tracking-widest font-bold text-primary-purple mb-2">
            Application error
          </p>
          <h1 className="text-[24px] font-semibold mb-3">Something crashed on this page</h1>
          <p className="text-[14px] text-purple-gray leading-relaxed mb-4">
            The app hit an error it didn't know how to recover from.
            Your work isn't lost — anything saved to the database is intact.
            Reload to start fresh, or use the back button to leave the broken page.
          </p>

          <div className="rounded-lg border border-lavender bg-white p-4 mb-4">
            <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-1">
              Error message
            </p>
            <p className="text-[13px] font-mono text-deep-plum break-words">
              {error.message || String(error)}
            </p>
          </div>

          <details className="text-[12px] text-purple-gray mb-6">
            <summary className="cursor-pointer hover:text-deep-plum">
              Technical details (paste this into a bug report)
            </summary>
            <pre className="mt-2 p-3 rounded bg-white border border-lavender overflow-x-auto whitespace-pre-wrap text-[11px]">
              {error.stack ?? '(no stack)'}
              {this.state.errorInfo?.componentStack && (
                <>{'\n\nComponent stack:'}{this.state.errorInfo.componentStack}</>
              )}
            </pre>
          </details>

          <div className="flex gap-3">
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white px-5 py-2 text-[13px] font-semibold hover:bg-primary-purple transition-colors"
            >
              Reload page →
            </button>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white px-5 py-2 text-[13px] text-deep-plum hover:bg-lavender-tint transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
