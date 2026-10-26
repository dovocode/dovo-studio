import { Component, createContext, type ContextType, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'
import { clientDiagnostic, diagnosticMessage, type ClientDiagnosticContext } from '@dovo/protocol'
import { copyTextToClipboard } from '../clipboard'
const DiagnosticContext = createContext<ClientDiagnosticContext>({})

export class ErrorBoundary extends Component<
  { children: ReactNode; scope?: 'view' | 'app'; diagnosticContext?: ClientDiagnosticContext },
  {
    error: string | null
    diagnostic: ReturnType<typeof clientDiagnostic> | null
    copyStatus: string
  }
> {
  static contextType = DiagnosticContext
  declare context: ContextType<typeof DiagnosticContext>
  state: {
    error: string | null
    diagnostic: ReturnType<typeof clientDiagnostic> | null
    copyStatus: string
  } = {
    error: null,
    diagnostic: null,
    copyStatus: '',
  }
  static getDerivedStateFromError(error: Error) {
    return { error: diagnosticMessage(error), diagnostic: clientDiagnostic(error), copyStatus: '' }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      this.props.scope === 'app' ? 'Workbench failed' : 'Extension view failed',
      error,
      info.componentStack,
    )
  }
  copyDiagnostic = async () => {
    try {
      await copyTextToClipboard(
        JSON.stringify(
          {
            ...this.state.diagnostic,
            context: {
              ...(this.props.diagnosticContext ?? this.context),
              surface: this.props.scope ?? 'view',
            },
          },
          null,
          2,
        ),
      )
      this.setState({ copyStatus: 'Diagnostics copied' })
    } catch (error) {
      this.setState({ copyStatus: diagnosticMessage(error) })
    }
  }
  diagnostics() {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>Diagnostic {this.state.diagnostic?.id}</p>
        <Button size="sm" variant="outline" onClick={() => void this.copyDiagnostic()}>
          Copy diagnostics
        </Button>
        {!!this.state.copyStatus && <p role="status">{this.state.copyStatus}</p>}
      </div>
    )
  }
  render() {
    if (!this.state.error)
      return this.props.diagnosticContext ? (
        <DiagnosticContext value={this.props.diagnosticContext}>
          {this.props.children}
        </DiagnosticContext>
      ) : (
        this.props.children
      )
    // The app scope catches failures outside a view (sidebars, title bar, dialogs), which
    // would otherwise blank the whole window. Workspace sync keeps running underneath.
    if (this.props.scope === 'app')
      return (
        <div role="alert" className="flex h-full items-center justify-center p-6">
          <div className="max-w-md space-y-3 rounded-lg border border-destructive/30 p-5">
            <h2 className="text-sm font-medium">Dovo hit a problem</h2>
            <p className="text-xs text-muted-foreground">
              Try again, or reload the window. Diagnostics stay on this device until you copy them.
            </p>
            <p className="break-words text-xs text-destructive">{this.state.error}</p>
            {this.diagnostics()}
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
        {this.diagnostics()}
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Retry view
        </Button>
      </div>
    )
  }
}
