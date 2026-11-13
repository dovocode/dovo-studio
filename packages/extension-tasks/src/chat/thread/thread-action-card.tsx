import { useRef, useState } from 'react'
import {
  RuntimeRequestError,
  decode,
  randomUUID,
  resolveScopedAgents,
  taskHarnessSchema,
  threadActionResultSchema,
  threadActionSendSchema,
  type Task,
  type ThreadAction,
  type ThreadActionSend,
  type ThreadActionResult,
} from '@dovo/protocol'
import {
  createTask,
  defaultTaskHarness,
  resolveTaskAgent,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { botScope } from '../../bots/bot-scope'
import { taskActionClient } from '../../list/task-row-actions'
import { ThreadActionEditor, type ThreadActionSelection } from './thread-action-editor'
import { AutomationActionCard } from './automation-action-card'

const attempts = new Map<string, ThreadActionSend>()

/** Cards without `automation` are new-thread cards, including all cards from older runtimes. */
export function ThreadActionCard({ task, action }: { task: Task; action: ThreadAction }) {
  return action.automation ? (
    <AutomationActionCard task={task} action={action} />
  ) : (
    <NewThreadActionCard task={task} action={action} />
  )
}

function NewThreadActionCard({ task, action }: { task: Task; action: ThreadAction }) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [editing, setEditing] = useState(false)
  const [result, setResult] = useState<ThreadAction>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const current = result && result.state !== 'prepared' ? result : action
  if (current.state === 'dismissed' || store.snapshot?.threadActionsSupported !== true) return null
  const scope = JSON.stringify([
    botScope(store.snapshot.runtimeId ?? store.activeRuntimeId, store.connection),
    task.id,
    action.id,
  ])
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  const agents = resolveScopedAgents(
    store.snapshot.defaults,
    task.bot ? undefined : repository,
    store.workspace.agents,
  )
  const source = resolveTaskAgent(task, agents) ?? defaultTaskHarness('codex')
  const suggested = action.suggestion?.agentId
    ? agents.find((agent) => agent.id === action.suggestion?.agentId)
    : undefined
  const base = decode(taskHarnessSchema, suggested ?? source)
  const initial: ThreadActionSelection = {
    prompt: action.prompt,
    repositoryId: task.repositoryId,
    agentId: suggested?.id,
    harness: decode(taskHarnessSchema, {
      ...(action.suggestion?.provider && action.suggestion.provider !== base.provider
        ? { ...defaultTaskHarness(action.suggestion.provider), permission: base.permission }
        : base),
      ...(action.suggestion?.model ? { model: action.suggestion.model } : {}),
      ...(action.suggestion?.reasoning ? { reasoning: action.suggestion.reasoning } : {}),
    }),
  }
  const client = taskActionClient(store, {
    runtimeId: store.activeRuntimeId,
    online: store.connected,
    name: 'Source computer',
  })
  const refresh = async () => {
    try {
      await client.refresh()
    } catch (cause) {
      setError(
        `Saved. Waiting for the source computer to refresh: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  const send = async (selection: ThreadActionSelection) => {
    let input = attempts.get(scope)
    if (!input) {
      const destination = store.workspace.repositories.find(
        (item) => item.id === selection.repositoryId,
      )
      if (!destination) throw Error('Choose an available project on this computer.')
      input = decode(threadActionSendSchema, {
        sourceTaskId: task.id,
        actionId: action.id,
        messageId: randomUUID(),
        createTask: {
          ...createTask({
            title: action.title,
            objective: '',
            agentId: selection.agentId ?? '',
            repositoryId: destination.id,
            harness: selection.harness,
            execution: destination.kind === 'scratch' ? 'main' : task.execution,
          }),
          harnessCustomized: true,
        },
        text: selection.prompt,
      })
      attempts.set(scope, input)
    }
    let response: ThreadActionResult
    try {
      response = await client.request('/api/thread-actions/send', input, threadActionResultSchema)
    } catch (cause) {
      if (cause instanceof RuntimeRequestError && cause.mutationRejected) attempts.delete(scope)
      throw cause
    }
    setResult(response.action)
    attempts.delete(scope)
    await refresh()
  }
  return (
    <section
      aria-label={`New thread action: ${action.title}`}
      data-thread-action={action.id}
      // Paired human consent: Studio UI tools cannot click or type in this card.
      data-studio-human-only="true"
      className="my-3 grid min-w-0 gap-3 rounded-xl border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{action.title}</h3>
        <span className="text-xs text-muted-foreground">
          {current.state === 'sent' ? 'Sent' : 'New agent thread'}
        </span>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
        {action.prompt}
      </p>
      {current.state === 'sent' && current.sent ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => host.navigate({ viewId: 'tasks', entityId: current.sent?.taskId })}
        >
          Open sent thread
        </Button>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Review the prompt, harness and model before Send. Choose its project on this computer.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!store.connected || busy || !store.workspace.repositories.length}
              onClick={() => setEditing(true)}
            >
              Review and Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!store.connected || busy}
              onClick={() => {
                if (lock.current) return
                lock.current = true
                setBusy(true)
                setError('')
                void client
                  .request(
                    '/api/thread-actions/dismiss',
                    { sourceTaskId: task.id, actionId: action.id },
                    threadActionResultSchema,
                  )
                  .then(async (response) => {
                    setResult(response.action)
                    await refresh()
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => {
                    lock.current = false
                    setBusy(false)
                  })
              }}
            >
              Dismiss
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {editing && current.state === 'prepared' && (
        <ThreadActionEditor
          key={scope}
          draftKey={scope}
          initial={initial}
          onSend={send}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  )
}
