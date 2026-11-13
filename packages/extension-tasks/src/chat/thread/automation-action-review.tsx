import { githubEventChoices, type AutomationData, type ThreadAction } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
} from '@dovo/studio-ui'

export type AutomationActionSnapshot = NonNullable<ThreadAction['automation']>
type Resource = AutomationActionSnapshot['resources'][number]

export function automationTriggerText(
  data: Pick<AutomationData, 'trigger' | 'schedule' | 'timezone' | 'runAt' | 'github'>,
) {
  if (data.trigger === 'manual') return 'Manual run'
  if (data.trigger === 'webhook') return 'Webhook'
  if (data.trigger === 'schedule') return `Schedule ${data.schedule} (${data.timezone})`
  if (data.trigger === 'once') return `Once at ${data.runAt ?? 'an unset time'} (${data.timezone})`
  const github = data.github
  if (!github) return 'GitHub event'
  const event = githubEventChoices.find((choice) => choice.id === github.event)?.name
  return [
    `GitHub ${event ?? github.event} on ${github.host}/${github.repository || 'any repository'}`,
    github.label && `label ${github.label}`,
    github.actor && `actor ${github.actor}`,
    github.requireWriteAccess && 'write access required',
  ]
    .filter(Boolean)
    .join(' · ')
}

export const automationBotNotice =
  'This step runs in the Bot’s thread with the Bot’s own current settings and resources. Its private instructions and secrets stay with the Bot and are not shown or copied.'

export function automationAccessText(agent: Resource['agent']) {
  return [
    agent.permission,
    agent.approvalPolicy && `approval ${agent.approvalPolicy}`,
    agent.sandboxMode && `sandbox ${agent.sandboxMode}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function ResourceRows({ resource }: { resource: Resource }) {
  const { agent } = resource
  const selection = agent.modelSelection
  return (
    <>
      {resource.botId && (
        <>
          <Row label="Bot">{resource.botName ?? resource.botId}</Row>
          <p role="note" className="text-muted-foreground">
            {automationBotNotice}
          </p>
        </>
      )}
      <Row label="Agent">
        {selection
          ? selection === 'inherit'
            ? 'Inherit · Project model applied at start'
            : `${selection === 'auto' ? 'Tune' : 'Maestro'} · Model chosen at start`
          : [agent.name, agent.provider, agent.model || 'default model', agent.reasoning]
              .filter(Boolean)
              .join(' · ')}
      </Row>
      <Row label="Access">{automationAccessText(agent)}</Row>
      <Row label="Checkout">{resource.repositoryName}</Row>
      {resource.execution && (
        <Row label="Execution">
          {resource.execution === 'worktree' ? 'New worktree' : 'Main checkout'}
        </Row>
      )}
      {resource.projects.length > 0 && (
        <Row label="Projects">
          <ul className="grid gap-0.5">
            {resource.projects.map((project) => (
              <li key={project.id}>
                {project.name}
                {project.path && <span className="text-muted-foreground"> · {project.path}</span>}
              </li>
            ))}
          </ul>
        </Row>
      )}
    </>
  )
}

/** Read-only view of the exact saved workflow and its effective resources. */
export function AutomationSnapshotView({ snapshot }: { snapshot: AutomationActionSnapshot }) {
  const { workflow } = snapshot
  const labels = new Map(workflow.nodes.map((node) => [node.id, node.data.label || node.id]))
  return (
    <div className="grid gap-3" aria-label="Saved workflow">
      {workflow.nodes.map((node, index) => {
        const resource = snapshot.resources.find((item) => item.nodeId === node.id)
        return (
          <section
            key={node.id}
            aria-label={`Step ${index + 1}: ${labels.get(node.id)}`}
            className="grid gap-2 rounded-lg border p-3 text-xs"
          >
            <h4 className="text-sm font-medium">
              {labels.get(node.id)}{' '}
              <span className="font-normal text-muted-foreground">({node.data.kind})</span>
            </h4>
            <dl className="grid gap-1">
              {node.data.kind === 'trigger' && (
                <Row label="Trigger">{automationTriggerText(node.data)}</Row>
              )}
              {node.data.kind !== 'trigger' && node.data.objective && (
                <Row label={resource?.botId ? 'Message to Bot' : 'Instructions'}>
                  <p className="whitespace-pre-wrap">{node.data.objective}</p>
                </Row>
              )}
              {resource && <ResourceRows resource={resource} />}
            </dl>
          </section>
        )
      })}
      {workflow.edges.length > 0 && (
        <section aria-label="Workflow connections" className="grid gap-1 text-xs">
          <h4 className="text-sm font-medium">Connections</h4>
          <ul className="grid gap-0.5">
            {workflow.edges.map((edge) => (
              <li key={edge.id}>
                {labels.get(edge.source) ?? edge.source} → {labels.get(edge.target) ?? edge.target}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The card owns dispatch, drafts and receipts. This dialog only presents them. */
export function AutomationActionReview({
  snapshot,
  text,
  frozen,
  busy,
  stale,
  error,
  blocked,
  onText,
  onStart,
  onRefresh,
  onClose,
}: {
  snapshot: AutomationActionSnapshot
  text: string
  frozen: boolean
  busy: boolean
  stale: boolean
  error: string
  blocked?: string
  onText: (text: string) => void
  onStart: () => void
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      {/* Portaled outside the card, so it needs its own human-only marker. */}
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        data-studio-human-only="true"
      >
        <DialogHeader>
          <DialogTitle>Start automation: {snapshot.workflow.name}</DialogTitle>
          <DialogDescription>
            Start runs this saved workflow once, with your context as external user input. Change
            the workflow itself in Automations.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onStart()
          }}
        >
          <FormField label="Run context">
            <Textarea
              aria-label="Automation run context"
              value={text}
              maxLength={20000}
              required
              disabled={busy || frozen}
              onChange={(event) => onText(event.target.value)}
            />
          </FormField>
          <AutomationSnapshotView snapshot={snapshot} />
          {blocked && <p role="status">{blocked}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {stale && (
            <p role="status" className="text-xs text-muted-foreground">
              The computer did not start this run. Refresh the review to see the current automation
              before Start. Your run context stays.
            </p>
          )}
          {frozen && (
            <p role="status" className="text-xs text-muted-foreground">
              The start may have reached the computer. Retry sends the same context and revision so
              it can recover the same run.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Close
            </Button>
            {!frozen && (
              <Button type="button" variant="outline" disabled={busy} onClick={onRefresh}>
                Refresh review
              </Button>
            )}
            <Button
              type="submit"
              disabled={busy || stale || !!blocked || (!frozen && !text.trim())}
            >
              {busy ? 'Starting…' : frozen ? 'Retry Start' : 'Start'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
