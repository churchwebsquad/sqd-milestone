import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional raw profile data to render as JSON fallback if rendering crashes */
  rawProfile?: unknown
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ProfileErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ProfileErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Profile rendering failed</p>
              <p className="text-xs text-red-600 mt-1">{this.state.error?.message ?? 'Unknown error'}</p>
              <p className="text-xs text-purple-gray mt-2">
                The profile was generated but couldn't be rendered in the structured view. Raw JSON is shown below — you can still save it to the database.
              </p>
            </div>
          </div>
          {this.props.rawProfile != null && (
            <pre className="mt-3 bg-lavender-tint/40 rounded-lg px-3 py-2 text-[10px] text-deep-plum overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify(this.props.rawProfile, null, 2)}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
