import { PageHeader } from '@dovo/studio-ui'
import { formatDateTime } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { ArrowLeft, Monitor } from 'lucide-react'
import { Button, ChoicePicker, IconButton } from '@dovo/studio-ui'
import { type FleetAutomation } from './fleet'
import { runLabels, runSteps } from './run-progress'
import { StepStatus } from './run-details'
export function CachedAutomation({
  row,
  busy,
  error,
  onOpen,
  onBack,
  initialRunId,
}: {
  row: FleetAutomation
  busy: boolean
  error: string
  onOpen: () => void
  onBack: () => void
  initialRunId?: string
}) {
  const [runId, setRunId] = useApplicationState(initialRunId ?? row.latest?.id)
  const run = runId ? row.runs.find((run) => run.id === runId) : row.latest
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={row.flow.name}
        description={
          <>
            <Monitor className="size-3" /> {row.runtimeName} · saved history
            {row.botJob && <span className="truncate"> · {row.botJob}</span>}
          </>
        }
        leading={
          <IconButton label="Back to automations" className="size-8" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </IconButton>
        }
      ></PageHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {busy
              ? `Opening ${row.runtimeName}…`
              : 'Connect to this computer to edit or run this automation.'}
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={onOpen}>
            {busy ? 'Connecting…' : 'Reconnect'}
          </Button>
          {error && (
            <p role="alert" className="w-full break-words text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        {run ? (
          <>
            <ChoicePicker
              aria-label="Saved automation run"
              value={run.id}
              onValueChange={setRunId}
              className="w-full"
            >
              {row.runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatDateTime(item.createdAt)} · {runLabels[item.status]}
                </option>
              ))}
            </ChoicePicker>
            {run.error && <p className="break-words text-xs text-destructive">{run.error}</p>}
            <ol aria-label="Saved run steps" className="divide-y">
              {runSteps(run, row.flow).map((step, index) => (
                <li key={step.nodeId} className="space-y-2 py-3">
                  <p className="text-xs font-medium">
                    {index + 1}. {step.label}
                  </p>
                  <StepStatus step={step} />
                  {step.error && (
                    <p className="break-words text-xs text-destructive">{step.error}</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="grid justify-items-start gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {runId ? "This run is not in this computer's saved recent history." : 'No runs yet.'}
            </p>
            {runId && row.latest && (
              <Button size="sm" variant="outline" onClick={() => setRunId(undefined)}>
                Show latest run
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
