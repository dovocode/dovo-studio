import { Play, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorkspace, type Automation } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { validateGraph } from './graph'
import type { JobActions } from './use-job-actions'

export function JobControls({
  flow,
  onEnabled,
  actions,
  onRun,
  children,
  configuringTriggers = false,
}: {
  flow: Automation
  onEnabled: (enabled: boolean) => void
  actions: JobActions
  onRun: (id: string) => void
  children?: ReactNode
  configuringTriggers?: boolean
}) {
  const { connected, snapshot, workspace, flush, syncError } = useWorkspace()
  const validation = validateGraph(flow, workspace)
  const active = snapshot?.runs.some(
    (run) => run.automationId === flow.id && (run.status === 'running' || run.status === 'waiting'),
  )
  const pending = actions.pendingStart(flow.id)
  const webhook = actions.webhook(flow.id)
  const disabled = !connected || actions.busy || !!syncError
  return (
    <div className="shrink-0 space-y-2 border-b px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={disabled || (!!active && !pending) || validation.length > 0}
          onClick={() => void actions.start(flow.id, onRun)}
        >
          {pending ? <RotateCw /> : <Play />}
          {pending ? 'Retry start' : 'Run automation'}
        </Button>
        {configuringTriggers && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || (!flow.enabled && validation.length > 0)}
            onClick={() =>
              void actions.act(async () => {
                onEnabled(!flow.enabled)
                await flush()
              })
            }
          >
            {flow.enabled ? 'Disable triggers' : 'Enable triggers'}
          </Button>
        )}
        {!connected && (
          <span className="text-xs text-muted-foreground">
            Connect a computer to run this automation.
          </span>
        )}
        {configuringTriggers &&
          snapshot?.owner &&
          flow.nodes.some(
            (node) => node.data.kind === 'trigger' && node.data.trigger === 'webhook',
          ) && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={disabled}
              onClick={() => void actions.rotateWebhook(flow.id)}
            >
              Rotate webhook credential
            </Button>
          )}
      </div>
      {validation.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {validation.length} issue{validation.length === 1 ? '' : 's'} to fix before running
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {validation.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      )}
      {syncError && (
        <p role="alert" className="text-xs text-destructive">
          {syncError}
        </p>
      )}
      {actions.error && (
        <p role="alert" className="text-xs text-destructive">
          {actions.error}
          {pending && ' Retry start checks the same request without starting a duplicate run.'}
        </p>
      )}
      {configuringTriggers && webhook && (
        <div className="rounded border p-2 text-xs">
          <p>POST {webhook.path} · Bearer token (shown once):</p>
          <code className="break-all select-all">{webhook.secret}</code>
          <p>Send X-Idempotency-Key for each unique delivery.</p>
        </div>
      )}
    </div>
  )
}
