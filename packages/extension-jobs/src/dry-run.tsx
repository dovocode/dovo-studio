import { useEffect, useRef, useState } from 'react'
import { Check, Circle, FlaskConical } from 'lucide-react'
import {
  automationDryRunCounts,
  automationDryRunFieldUse,
  automationDryRunFields,
  automationDryRunOutcomeText,
  automationDryRunRequest,
  automationDryRunSchema,
  automationDryRunStatusText,
  dryRunScenario,
  dryRunScenarioFields,
  randomUUID,
  type Automation,
  type AutomationDryRun,
  type AutomationDryRunStepStatus,
  type AutomationDryRunRequest,
  type DryRunScenario,
} from '@dovo/protocol'
import { useDryRunScenarios, useWorkspace } from '@dovo/studio-core'
import { Button, ChoicePicker, cn, FormField, Input, Textarea } from '@dovo/studio-ui'

const statusIcons = { ran: Check, simulated: FlaskConical, 'not-reached': Circle }
const statusTone: Record<AutomationDryRunStepStatus, string> = {
  ran: 'text-status-success',
  simulated: 'text-primary',
  'not-reached': 'text-muted-foreground',
}

/** Test a flow with sample data. The runtime runs no external step and saves nothing. */
export function DryRunPanel({ flow }: { flow: Automation }) {
  const { request, connection, connected, snapshot } = useWorkspace()
  const [fields, setFields] = useState(() => automationDryRunFields(flow))
  const [result, setResult] = useState<AutomationDryRun>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastInput, setLastInput] = useState<AutomationDryRunRequest>()
  const [scenarioName, setScenarioName] = useState('')
  const [editing, setEditing] = useState<DryRunScenario>()
  const scenarioId = useRef<string | undefined>(undefined)
  const canSaveScenarios =
    !!snapshot?.automationDryRunScenariosSupported &&
    snapshot.workspace.automations.some((item) => item.id === flow.id)
  const scenarios = useDryRunScenarios(flow, request, connection, canSaveScenarios && connected)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setResult(undefined)
    setError('')
    setBusy(false)
    setLastInput(undefined)
    setScenarioName('')
    setEditing(undefined)
    scenarioId.current = undefined
  }, [connection, flow.id])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const use = automationDryRunFieldUse(flow)
  const start = async () => {
    const version = ++generation.current
    setError('')
    try {
      const body = automationDryRunRequest(flow, fields)
      setBusy(true)
      const next = await request('/api/jobs/dry-run', body, automationDryRunSchema)
      if (version === generation.current) {
        setLastInput(body)
        setResult(next)
      }
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (version === generation.current) setBusy(false)
    }
  }
  return (
    <section aria-label="Dry run" className="grid gap-3 text-xs">
      <p className="leading-relaxed text-muted-foreground">
        Test this automation with sample data. The trigger runs for real. Tasks, reviews and source
        checks are simulated. Nothing is started, saved, sent or counted as a run.
      </p>
      {use.payload && (
        <FormField label="Sample trigger data (JSON)">
          <Textarea
            aria-label="Sample trigger data (JSON)"
            className="min-h-28 font-mono text-xs"
            value={fields.payload}
            onChange={(event) => setFields((value) => ({ ...value, payload: event.target.value }))}
          />
        </FormField>
      )}
      {use.scheduledFor && (
        <FormField label="Sample due time">
          <Input
            aria-label="Sample due time"
            placeholder="2026-11-16T09:00:00Z"
            value={fields.scheduledFor}
            onChange={(event) =>
              setFields((value) => ({ ...value, scheduledFor: event.target.value }))
            }
          />
        </FormField>
      )}
      {use.source && (
        <>
          <FormField label="Sample source content">
            <Textarea
              aria-label="Sample source content"
              className="min-h-20 text-xs"
              value={fields.sourceText}
              onChange={(event) =>
                setFields((value) => ({ ...value, sourceText: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Source since the last successful run">
            <ChoicePicker
              aria-label="Source since the last successful run"
              value={fields.sourceUnchanged ? 'unchanged' : 'changed'}
              onValueChange={(choice) =>
                setFields((value) => ({ ...value, sourceUnchanged: choice === 'unchanged' }))
              }
              className="h-8 w-full rounded border bg-background px-2 text-xs"
            >
              <option value="changed">Changed</option>
              <option value="unchanged">Unchanged</option>
            </ChoicePicker>
          </FormField>
        </>
      )}
      {snapshot?.automationDryRunScenariosSupported && use.results.length > 0 && (
        <FormField label="Sample step results (JSON)">
          <Textarea
            aria-label="Sample step results (JSON)"
            className="min-h-24 font-mono text-xs"
            maxLength={16384}
            value={fields.stepResults}
            onChange={(event) =>
              setFields((value) => ({ ...value, stepResults: event.target.value }))
            }
          />
          <p className="text-muted-foreground">
            Use the step ID as the JSON key.{' '}
            {use.results.map(({ id, label }) => `${label} (${id})`).join(', ')}
          </p>
        </FormField>
      )}
      {use.stops.length > 0 && (
        <FormField label="Simulated outcome">
          <ChoicePicker
            aria-label="Simulated outcome"
            value={fields.stopAt || 'pass'}
            onValueChange={(stopAt) =>
              setFields((value) => ({ ...value, stopAt: stopAt === 'pass' ? '' : stopAt }))
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs"
          >
            <option value="pass">Every step succeeds</option>
            {use.stops.map((step) => (
              <option key={step.id} value={step.id}>
                {step.kind === 'review' ? `Reject at ${step.label}` : `Fail at ${step.label}`}
              </option>
            ))}
          </ChoicePicker>
        </FormField>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!connected || busy} onClick={() => void start()}>
          <FlaskConical />
          {busy ? 'Running dry run' : 'Start dry run'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setFields(automationDryRunFields(flow))}
        >
          Reset sample data
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      )}
      {result && <DryRunResult result={result} />}
      {canSaveScenarios && (
        <section className="grid gap-2 border-t pt-3" aria-label="Saved Dry run scenarios">
          {scenarios.cases.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={scenarios.busy || busy || !connected}
              onClick={() => void scenarios.run()}
            >
              Run saved scenarios
            </Button>
          )}
          {scenarios.cases.map((scenario) => {
            const check = scenarios.checks?.find((item) => item.id === scenario.id)
            return (
              <div key={scenario.id} className="grid gap-1 rounded border p-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || scenarios.busy}
                    onClick={() => {
                      setFields(dryRunScenarioFields(scenario))
                      setScenarioName(scenario.name)
                      setEditing(scenario)
                      setResult(undefined)
                      setLastInput(undefined)
                    }}
                  >
                    {scenario.name}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={scenarios.busy || !connected}
                    aria-label={`Delete scenario ${scenario.name}`}
                    onClick={() => void scenarios.remove(scenario)}
                  >
                    Delete
                  </Button>
                  {check && <span role="status">{check.issues.length ? 'Changed' : 'Passed'}</span>}
                </div>
                {check?.issues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            )
          })}
          {result && lastInput && (
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Scenario name"
                placeholder="Scenario name"
                maxLength={100}
                value={scenarioName}
                onChange={(event) => setScenarioName(event.target.value)}
              />
              <Button
                size="sm"
                disabled={scenarios.busy || busy || !connected || !scenarioName.trim()}
                onClick={async () => {
                  if (
                    await scenarios.save(
                      dryRunScenario(
                        editing?.id ?? (scenarioId.current ??= randomUUID()),
                        scenarioName,
                        lastInput,
                        result,
                      ),
                      editing,
                    )
                  ) {
                    setScenarioName('')
                    setEditing(undefined)
                    scenarioId.current = undefined
                  }
                }}
              >
                {editing ? 'Update scenario' : 'Save as scenario'}
              </Button>
              {editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(undefined)
                    setScenarioName('')
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          )}
          {scenarios.error && <p role="alert">{scenarios.error}</p>}
        </section>
      )}
    </section>
  )
}

function DryRunResult({ result }: { result: AutomationDryRun }) {
  const counts = automationDryRunCounts(result)
  return (
    <div aria-label="Dry run result" className="grid gap-3 border-t pt-3">
      <div role="status">
        <p className="font-medium">{automationDryRunOutcomeText[result.outcome]}</p>
        <p className="mt-1 text-muted-foreground">
          {counts.ran} ran · {counts.simulated} simulated · {counts.notReached} not reached
          {result.generated && ' · generated sample data'}
        </p>
      </div>
      {[...result.issues, ...result.warnings].map((message, index) => (
        <p key={`${index}:${message}`} role="alert" className="break-words text-status-warning">
          {message}
        </p>
      ))}
      <ol aria-label="Dry run steps" className="divide-y rounded-lg border">
        {result.steps.map((step) => {
          const Icon = statusIcons[step.status]
          return (
            <li key={step.nodeId} className="grid gap-1.5 p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{step.label}</span>
                <span
                  className={cn('inline-flex items-center gap-1.5', statusTone[step.status])}
                  data-status={step.status}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {automationDryRunStatusText[step.status]}
                </span>
              </div>
              {step.note && <p className="break-words">{step.note}</p>}
              {step.output && (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {step.output}
                </p>
              )}
              {step.inputs.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Inputs {step.status === 'simulated' && 'this step would receive'}
                  </summary>
                  <dl className="mt-2 grid gap-2">
                    {step.inputs.map((item) => (
                      <div key={item.name}>
                        <dt className="font-medium">{item.name}</dt>
                        <dd className="mt-0.5 max-h-60 overflow-auto rounded bg-muted/40 p-2 font-mono whitespace-pre-wrap break-words">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          )
        })}
      </ol>
      {result.unexercised.length > 0 && (
        <div>
          <p className="font-medium">Not tested by this dry run</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
            {result.unexercised.map((item, index) => (
              <li key={`${index}:${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
