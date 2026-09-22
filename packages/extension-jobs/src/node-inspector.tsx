import { ChoicePicker } from '@dovo/studio-ui'
import type { AutomationData, AutomationNode, Workspace } from '@dovo/studio-core'
import { Button, FormField, Input, Textarea } from '@dovo/studio-ui'
export function NodeInspector({
  node,
  workspace,
  onChange,
  onDelete,
}: {
  node: AutomationNode
  workspace: Workspace
  onChange: (data: AutomationData) => void
  onDelete: () => void
}) {
  const data = node.data
  const field = (patch: Partial<AutomationData>) => onChange({ ...data, ...patch })
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">
      <h2 className="font-medium">Configure {data.kind}</h2>
      <FormField label="Name">
        <Input value={data.label} onChange={(event) => field({ label: event.target.value })} />
      </FormField>
      {data.kind === 'trigger' && (
        <>
          <FormField label="Trigger">
            <ChoicePicker
              aria-label="Trigger"
              className="h-9 w-full rounded-md border bg-background px-2"
              value={data.trigger}
              onValueChange={(selection) => {
                const value = selection
                if (value === 'manual' || value === 'schedule' || value === 'webhook')
                  field({ trigger: value })
              }}
            >
              <option value="manual">Manual</option>
              <option value="schedule">Schedule</option>
              <option value="webhook">External webhook</option>
            </ChoicePicker>
          </FormField>
          {data.trigger === 'schedule' && (
            <>
              <FormField label="Cron expression">
                <Input
                  value={data.schedule}
                  onChange={(event) => field({ schedule: event.target.value })}
                />
              </FormField>
              <FormField label="Time zone">
                <Input
                  value={data.timezone}
                  onChange={(event) => field({ timezone: event.target.value })}
                />
              </FormField>
            </>
          )}
          <p className="text-muted-foreground">
            Enable triggers to schedule this flow or accept authenticated webhook deliveries. The
            runtime must remain running.
          </p>
        </>
      )}
      {data.kind === 'task' && (
        <>
          <FormField label="Agent">
            <ChoicePicker
              aria-label="Agent"
              className="h-9 w-full rounded-md border bg-background px-2"
              value={data.agentId}
              onValueChange={(selection) => field({ agentId: selection })}
            >
              {workspace.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          <FormField label="Repository">
            <ChoicePicker
              aria-label="Repository"
              className="h-9 w-full rounded-md border bg-background px-2"
              value={data.repositoryId}
              onValueChange={(selection) => field({ repositoryId: selection })}
            >
              {workspace.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          <FormField label="Working directory">
            <ChoicePicker
              aria-label="Working directory"
              className="h-9 rounded-md border bg-background px-2 text-xs"
              value={data.execution ?? 'main'}
              onValueChange={(selection) => {
                const execution = selection
                if (execution === 'main' || execution === 'worktree') field({ execution })
              }}
            >
              <option value="main">Project checkout</option>
              <option value="worktree">Dedicated task worktree</option>
            </ChoicePicker>
          </FormField>
          <FormField label="Instructions">
            <Textarea
              rows={7}
              value={data.objective}
              onChange={(event) => field({ objective: event.target.value })}
            />
          </FormField>
        </>
      )}
      {data.kind === 'review' && (
        <p className="text-muted-foreground">
          This step represents a human approval before downstream work may execute.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={onDelete}>
        Delete node
      </Button>
    </div>
  )
}
