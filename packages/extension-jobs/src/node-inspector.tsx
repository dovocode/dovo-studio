import { useState } from 'react'
import { defaultGithubTrigger, githubEventChoices, automationScheduleChoices } from '@dovo/protocol'
import {
  resolveScopedAgents,
  type RuntimeDefaults,
  defaultTaskHarness,
  resolveTaskAgent,
  decode,
  taskHarnessSchema,
} from '@dovo/protocol'
import { ChoicePicker, HarnessFields, LinkedCheckoutEditor } from '@dovo/studio-ui'
import type { AutomationData, AutomationNode, Workspace } from '@dovo/studio-core'
import { Button, FormField, Input, Textarea } from '@dovo/studio-ui'
export function NodeInspector({
  node,
  workspace,
  defaults,
  onChange,
  onDelete,
}: {
  node: AutomationNode
  workspace: Workspace
  defaults?: RuntimeDefaults
  onChange: (data: AutomationData) => void
  onDelete: () => void
}) {
  const data = node.data
  const [customSchedule, setCustomSchedule] = useState(false)
  const agents = resolveScopedAgents(
    defaults,
    workspace.repositories.find((repo) => repo.id === data.repositoryId),
    workspace.agents,
  )
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
                if (
                  value === 'manual' ||
                  value === 'schedule' ||
                  value === 'webhook' ||
                  value === 'github'
                )
                  field({
                    trigger: value,
                    ...(value === 'github'
                      ? { github: data.github ?? { ...defaultGithubTrigger } }
                      : {}),
                  })
              }}
            >
              <option value="manual">Manual</option>
              <option value="schedule">Schedule</option>
              <option value="webhook">External webhook</option>
              <option value="github">GitHub event</option>
            </ChoicePicker>
          </FormField>
          {data.trigger === 'schedule' && (
            <>
              <FormField label="Schedule preset">
                <ChoicePicker
                  aria-label="Schedule preset"
                  value={
                    !customSchedule &&
                    automationScheduleChoices.some((item) => item.id === data.schedule)
                      ? data.schedule
                      : 'custom'
                  }
                  onValueChange={(value) => {
                    setCustomSchedule(value === 'custom')
                    if (value !== 'custom') field({ schedule: value })
                  }}
                >
                  {automationScheduleChoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
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
          {data.trigger === 'github' &&
            (() => {
              const github = data.github ?? defaultGithubTrigger
              const update = (patch: Partial<typeof github>) =>
                field({ github: { ...github, ...patch } })
              const hasActor = github.event !== 'pull_request.synchronized'
              return (
                <>
                  <FormField label="GitHub host">
                    <Input
                      value={github.host}
                      placeholder="github.com"
                      onChange={(event) => update({ host: event.target.value })}
                    />
                  </FormField>
                  <FormField label="GitHub repository">
                    <Input
                      value={github.repository}
                      placeholder="owner/repository"
                      onChange={(event) => update({ repository: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Event">
                    <ChoicePicker
                      aria-label="GitHub event"
                      value={github.event}
                      onValueChange={(value) => {
                        const choice = githubEventChoices.find((item) => item.id === value)
                        if (choice)
                          update({
                            event: choice.id,
                            ...(choice.id === 'pull_request.synchronized'
                              ? { actor: '', requireWriteAccess: false }
                              : {}),
                          })
                      }}
                    >
                      {githubEventChoices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </ChoicePicker>
                  </FormField>
                  <FormField label="Label filter (optional)">
                    <Input
                      value={github.label}
                      onChange={(event) => update({ label: event.target.value })}
                    />
                  </FormField>
                  {hasActor && (
                    <>
                      <FormField label="Actor login (optional)">
                        <Input
                          value={github.actor}
                          placeholder="octocat"
                          onChange={(event) => update({ actor: event.target.value })}
                        />
                      </FormField>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={github.requireWriteAccess}
                          onChange={(event) => update({ requireWriteAccess: event.target.checked })}
                        />
                        Require actor write access
                      </label>
                    </>
                  )}
                  <p className="text-muted-foreground">
                    Uses the runtime host’s gh login. Polls every minute while this computer is
                    running. Existing events are not replayed when enabling a trigger.
                  </p>
                  {github.event === 'pull_request.synchronized' && (
                    <p className="text-muted-foreground">
                      Detects changes to the PR head after its first observation. Pushes between
                      polls are combined; GitHub does not expose the pusher here.
                    </p>
                  )}
                  {github.event === 'discussion.updated' && (
                    <p className="text-muted-foreground">
                      Detects the latest discussion edit; multiple edits between polls are combined.
                    </p>
                  )}
                </>
              )
            })()}
          <p className="text-muted-foreground">
            Enable triggers to schedule this flow, watch GitHub events or accept authenticated
            webhook deliveries. The runtime must remain running.
          </p>
        </>
      )}
      {data.kind === 'task' && (
        <>
          <HarnessFields
            agents={agents}
            selectedAgentId={data.agentId || undefined}
            onSelectAgent={(agentId) => {
              const agent = agents.find((entry) => entry.id === agentId)
              if (agent)
                field({
                  agentId,
                  harness: decode(taskHarnessSchema, agent),
                  agentOverrides: undefined,
                })
            }}
            value={decode(
              taskHarnessSchema,
              resolveTaskAgent({ ...data, id: node.id }, agents) ?? defaultTaskHarness('codex'),
            )}
            onChange={(harness) => field({ agentId: '', agentOverrides: undefined, harness })}
          />
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
          <LinkedCheckoutEditor
            value={data.linkedCheckouts ?? []}
            onChange={(linkedCheckouts) => field({ linkedCheckouts })}
          />
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
