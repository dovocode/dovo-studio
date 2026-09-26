import { useApplicationState } from '@dovo/studio-core/state'
import { ArrowLeft, Ellipsis, Monitor, Plus, Workflow, X } from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  useCompactLayout,
} from '@dovo/studio-ui'
import { JobControls } from './job-controls'
import { AutomationCanvas } from './automation-canvas'
import { NodeInspector } from './node-inspector'
import { newNode, validateGraph } from './graph'
import { useAutomation } from './use-automation'
import { useJobActions } from './use-job-actions'
import { RunDetails } from './run-details'
export function AutomationDetail({
  automationId,
  onBack,
  initialSurface = 'runs',
}: {
  automationId: string
  onBack: () => void
  initialSurface?: 'runs' | 'canvas'
}) {
  const { workspace, flow, selectedNode, selectNode, messages, setMessages, update, drafts } =
    useAutomation(automationId)
  const { snapshot, connected } = useWorkspace()
  const compact = useCompactLayout()
  const actions = useJobActions()
  const [runId, setRunId] = useApplicationState<string | null>(null)
  const [surface, setSurface] = useApplicationState<'runs' | 'canvas' | 'triggers'>(initialSurface)
  const [inspectorOpen, setInspectorOpen] = useApplicationState(false)
  const runs = (snapshot?.runs.filter((run) => run.automationId === flow?.id) ?? []).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
  const run = runs.find((item) => item.id === runId) ?? runs[0]
  const selectRun = (id: string) => {
    setRunId(id)
    setSurface('runs')
    setInspectorOpen(false)
  }
  const configure = (id: string | null) => {
    selectNode(id)
    setInspectorOpen(!!id)
  }
  const node = flow?.nodes.find((item) => item.id === selectedNode)
  const addStep = (kind: 'trigger' | 'task' | 'review') => {
    if (!flow) return
    const next = newNode(kind, workspace, flow.nodes.length)
    update((current) => ({
      ...current,
      nodes: [...current.nodes, next],
    }))
    configure(next.id)
  }
  const triggers = flow?.nodes.filter((item) => item.data.kind === 'trigger') ?? []
  const menuItem =
    'flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent'
  const inspector = node && (
    <NodeInspector
      node={node}
      workspace={workspace}
      onChange={(data) =>
        update((current) => ({
          ...current,
          nodes: current.nodes.map((item) =>
            item.id === node.id
              ? {
                  ...item,
                  data,
                }
              : item,
          ),
        }))
      }
      onDelete={() => {
        update((current) => ({
          ...current,
          nodes: current.nodes.filter((item) => item.id !== node.id),
          edges: current.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
        }))
        selectNode(null)
        setInspectorOpen(false)
      }}
    />
  )
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3">
        <IconButton label="Back to automations" className="size-8" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{flow?.name ?? 'Automation unavailable'}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <Monitor className="size-3" />
            Runs on {snapshot?.runtimeHost ?? 'the selected computer'}
            {!connected && ' · offline'}
          </p>
        </div>
        {flow && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="Automation actions" className="size-8">
                <Ellipsis className="size-4" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-48 rounded-lg border bg-popover p-1 shadow-lg"
              >
                <DropdownMenu.Item
                  className={menuItem}
                  onSelect={() => {
                    const issues = validateGraph(flow, workspace)
                    setMessages(issues.length ? issues : ['Automation is valid.'])
                  }}
                >
                  Validate automation
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menuItem} onSelect={drafts}>
                  Create task drafts
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </header>
      {flow ? (
        <>
          <JobControls
            key={flow.id}
            flow={flow}
            actions={actions}
            onRun={selectRun}
            configuringTriggers={surface === 'triggers'}
            onEnabled={(enabled) =>
              update((current) => ({
                ...current,
                enabled,
              }))
            }
          >
            <div
              role="group"
              aria-label="Automation view"
              className="flex items-center gap-1 rounded-lg bg-muted/40 p-0.5"
            >
              {(['runs', 'canvas', 'triggers'] as const).map((view) => (
                <Button
                  key={view}
                  variant="ghost"
                  size="sm"
                  aria-pressed={surface === view}
                  className={cn(
                    'h-8 rounded-md px-3 text-xs',
                    surface === view && 'bg-background shadow-sm',
                  )}
                  onClick={() => {
                    setSurface(view)
                    setInspectorOpen(false)
                  }}
                >
                  {view === 'runs' ? 'Runs' : view === 'canvas' ? 'Canvas' : 'Triggers'}
                </Button>
              ))}
            </div>
          </JobControls>
          {messages.length > 0 && (
            <div role="status" className="flex items-start gap-2 border-b px-4 py-2 text-xs">
              <div className="min-w-0 flex-1">
                {messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
              <IconButton
                label="Dismiss automation notice"
                className="size-6"
                onClick={() => setMessages([])}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          )}
          <div className="flex min-h-0 min-w-0 flex-1">
            {surface === 'runs' ? (
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-col">
                <RunDetails
                  flow={flow}
                  runs={runs}
                  run={run}
                  selectRun={selectRun}
                  actions={actions}
                  onStep={(id) => {
                    setSurface('canvas')
                    configure(id)
                  }}
                />
              </div>
            ) : surface === 'canvas' ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
                  <Input
                    aria-label="Automation name"
                    className="h-8 min-w-0 max-w-64 flex-1 text-xs"
                    key={`${flow.id}:${flow.name}`}
                    defaultValue={flow.name}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim() || 'Untitled automation'
                      event.currentTarget.value = name
                      update((current) => ({
                        ...current,
                        name,
                      }))
                    }}
                  />
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button size="sm" variant="outline">
                        <Plus className="size-3.5" />
                        Add step
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="start"
                        sideOffset={6}
                        className="z-50 min-w-44 rounded-lg border bg-popover p-1 shadow-lg"
                      >
                        {(['trigger', 'task', 'review'] as const).map((kind) => (
                          <DropdownMenu.Item
                            className={menuItem}
                            key={kind}
                            onSelect={() => addStep(kind)}
                          >
                            {kind === 'trigger'
                              ? 'Trigger'
                              : kind === 'task'
                                ? 'Agent task'
                                : 'Review gate'}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                  <span className="ml-auto text-[0.6875rem] text-muted-foreground">
                    Connect steps in the order they run
                  </span>
                </div>
                <div className="min-h-0 flex-1">
                  <AutomationCanvas
                    key={flow.id}
                    flow={flow}
                    steps={[]}
                    selectedNode={selectedNode}
                    onSelect={configure}
                    update={update}
                  />
                </div>
              </div>
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-2xl">
                  <h2 className="text-sm font-medium">When this automation runs</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {flow.enabled
                      ? 'Scheduled and webhook triggers are enabled.'
                      : 'Scheduled and webhook triggers are paused. You can still run manually.'}{' '}
                    This computer must stay online.
                  </p>
                  <div className="mt-5 divide-y rounded-lg border">
                    {triggers.map((trigger) => (
                      <button
                        key={trigger.id}
                        className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent"
                        onClick={() => configure(trigger.id)}
                      >
                        <Workflow className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {trigger.data.label}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {trigger.data.trigger === 'schedule'
                              ? `${trigger.data.schedule} · ${trigger.data.timezone}`
                              : trigger.data.trigger === 'webhook'
                                ? 'Authenticated webhook'
                                : 'Manual start'}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">Configure</span>
                      </button>
                    ))}
                  </div>
                  <Button
                    className="mt-4"
                    variant="outline"
                    size="sm"
                    onClick={() => addStep('trigger')}
                  >
                    <Plus className="size-3.5" />
                    Add trigger
                  </Button>
                </div>
              </div>
            )}
            {!compact && surface !== 'runs' && inspectorOpen && node && (
              <aside className="flex w-80 min-w-0 shrink-0 flex-col border-l bg-sidebar">
                <div className="flex justify-end border-b px-3 py-2">
                  <IconButton
                    label="Close step settings"
                    className="size-7"
                    onClick={() => setInspectorOpen(false)}
                  >
                    <X className="size-4" />
                  </IconButton>
                </div>
                {inspector}
              </aside>
            )}
          </div>
          <Dialog open={compact && inspectorOpen && !!node} onOpenChange={setInspectorOpen}>
            <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
              <DialogTitle>Step settings</DialogTitle>
              <DialogDescription className="sr-only">
                Configure the selected automation step.
              </DialogDescription>
              {inspector}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <EmptyState
          icon={<Workflow />}
          title="Automation unavailable"
          description="This automation may have been removed. Return to the list to choose another."
          action={<Button onClick={onBack}>Back to automations</Button>}
        />
      )}
    </section>
  )
}
