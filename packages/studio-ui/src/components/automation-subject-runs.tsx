import { useState } from 'react'
import type { AutomationRunSubject } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { useAutomationSubjectRuns } from '@dovo/studio-core/automation-subject-runs'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

export function AutomationSubjectRuns({ subject }: { subject: AutomationRunSubject }) {
  const uiText = useInterfaceText()
  const [open, setOpen] = useState(false)
  const host = useStudioHost()
  const { activeRuntimeId, connected, connection, request, snapshot, workspace } = useWorkspace()
  const supported = snapshot?.automationRunSubjectSupported === true
  const { runs, error, loading } = useAutomationSubjectRuns({
    subject: open && supported ? subject : undefined,
    connection,
    connected,
    request,
  })
  if (!supported) return null
  return (
    <details className="text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer py-2 font-medium">{uiText('Automation runs')}</summary>
      {open && (
        <div className="space-y-1">
          {loading && <p role="status">{uiText('Loading automation runs…')}</p>}
          {error && <p role="alert">{error}</p>}
          {!connected && !runs && <p>{uiText('Reconnect to find automation runs.')}</p>}
          {runs?.length === 0 && <p>{uiText('No automation runs found.')}</p>}
          {runs?.map((run) => (
            <button
              key={run.id}
              type="button"
              className="block w-full rounded-md px-2 py-1 text-left hover:bg-accent"
              onClick={() =>
                host.navigate({
                  viewId: 'jobs',
                  entityId: run.id,
                  ...(activeRuntimeId
                    ? {
                        automationTarget: {
                          runtimeId: activeRuntimeId,
                          automationId: run.automationId,
                          runId: run.id,
                        },
                      }
                    : {}),
                })
              }
            >
              {workspace.automations.find((flow) => flow.id === run.automationId)?.name ??
                run.automationId}
              {' · '}
              {run.status}
            </button>
          ))}
        </div>
      )}
    </details>
  )
}
