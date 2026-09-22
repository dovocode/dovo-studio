import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Extension view failed', error, info.componentStack)
  }
  render() {
    if (this.state.error)
      return (
        <div role="alert" className="m-6 space-y-3 rounded-lg border border-destructive/30 p-5">
          <h2>This view could not load</h2>
          <p className="text-xs text-muted-foreground">{this.state.error}</p>
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            Retry view
          </Button>
        </div>
      )
    return this.props.children
  }
}
