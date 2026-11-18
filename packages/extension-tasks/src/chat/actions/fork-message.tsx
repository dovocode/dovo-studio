import { useRef, useState } from 'react'
import { GitFork } from 'lucide-react'
import {
  forkFileDescription,
  forkMessagePreview,
  messageForkBlocker,
  randomUUID,
  resolveTaskDefaults,
  taskForkResultSchema,
  threadForkBlocker,
  type ConversationTurn,
} from '@dovo/protocol'
import { useConfirmation, useStudioHost, useWorkspace, type Task } from '@dovo/studio-core'
import { MessageAction } from '@dovo/studio-ui'

/** Starts a new thread with the conversation up to and including this message. */
export function ForkMessage({
  taskId,
  message,
  status,
}: {
  taskId: string
  message: Task['messages'][number]
  status: ConversationTurn['status']
}) {
  const { request, connected, workspace, snapshot } = useWorkspace()
  const confirm = useConfirmation()
  const host = useStudioHost()
  // One ID per fork attempt, so a retry after a lost reply returns the same thread.
  const forkId = useRef<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const task = workspace.tasks.find((item) => item.id === taskId)
  if (!task || task.bot || !snapshot?.messageForkSupported) return null
  if (messageForkBlocker(message, status, task.status === 'running')) return null
  const fork = async () => {
    const blocker = threadForkBlocker(task)
    if (blocker) return setError(blocker)
    const navigationCurrent = host.taskNavigationGuard?.()
    const project = workspace.repositories.find((repo) => repo.id === task.repositoryId)
    const defaults = resolveTaskDefaults(snapshot.defaults, project)
    const selected = message.role === 'assistant' ? 'reply' : 'message'
    if (
      !(await confirm({
        title: 'Fork conversation?',
        description: `The new thread includes the conversation up to and including this ${selected}. It uses this thread’s harness, model and access. Files are not rewound. ${forkFileDescription(defaults.execution, project?.kind)}`,
        details: `Selected ${selected}: ${forkMessagePreview(message) || '(No message text)'}`,
        confirmLabel: 'Fork',
      }))
    )
      return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/tasks/fork-message',
        { id: taskId, messageId: message.id, forkId: (forkId.current ??= randomUUID()) },
        taskForkResultSchema,
      )
      forkId.current = undefined
      if (!navigationCurrent || navigationCurrent())
        host.navigate({ viewId: 'tasks', entityId: result.id, messageId: message.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <MessageAction
        label="Fork conversation: a new thread with the conversation up to this message. Files are not rewound."
        className="size-6 text-muted-foreground"
        disabled={!connected || busy}
        onClick={() => void fork()}
      >
        <GitFork size={12} />
      </MessageAction>
      {error && (
        <span role="alert" className="text-[0.625rem] text-destructive">
          {error}
        </span>
      )}
    </>
  )
}
