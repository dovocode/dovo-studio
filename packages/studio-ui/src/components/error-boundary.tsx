import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'
export class ErrorBoundary extends Component<
  { children: ReactNode; scope?: 'view' | 'app' },
  { error: string | null }
> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      this.props.scope === 'app' ? 'Workbench failed' : 'Extension view failed',
      error,
      info.componentStack,
    )
  }
  render() {
    if (!this.state.error) return this.props.children
    // The app scope catches failures outside a view (sidebars, title bar, dialogs), which
    // would otherwise blank the whole window. Workspace sync keeps running underneath.
    if (this.props.scope === 'app')
      return (
        <div role="alert" className="flex h-full items-center justify-center p-6">
          <div className="max-w-md space-y-3 rounded-lg border border-destructive/30 p-5">
            <h2 className="text-sm font-medium">Dovo hit a problem</h2>
            <p className="text-xs text-muted-foreground">
              Your tasks and unsynced edits are safe. Try again, or reload the window.
            </p>
            <p className="break-words text-xs text-destructive">{this.state.error}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Reload window
              </Button>
            </div>
          </div>
        </div>
      )
    return (
      <div role="alert" className="m-6 space-y-3 rounded-lg border border-destructive/30 p-5">
        <h2>This view could not load</h2>
        <p className="text-xs text-muted-foreground">{this.state.error}</p>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Retry view
        </Button>
      </div>
    )
  }
}
