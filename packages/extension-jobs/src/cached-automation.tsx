import { ArrowLeft, Monitor } from 'lucide-react'
import { useState } from 'react'
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
}: {
  row: FleetAutomation
  busy: boolean
  error: string
  onOpen: () => void
  onBack: () => void
}) {
  const [runId, setRunId] = useState(row.latest?.id)
  const run = row.runs.find((run) => run.id === runId) ?? row.latest
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <IconButton label="Back to automations" className="size-8" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{row.flow.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Monitor className="size-3" /> {row.runtimeName} · saved history
          </p>
        </div>
      </header>
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
                  {new Date(item.createdAt).toLocaleString()} · {runLabels[item.status]}
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
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        )}
      </div>
    </section>
  )
}
