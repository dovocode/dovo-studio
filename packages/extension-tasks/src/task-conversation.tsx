import { useMemo } from 'react'
import { LoaderCircle, GitFork, Folder } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import { visiblePendingMessage, type PendingMessage } from '@dovo/protocol'
import { MessageQueue } from './chat/message-queue'
import { TaskQuestions } from './chat/task-questions'
import { RunControls } from './chat/run-controls'
import { type Task } from '@dovo/studio-core'
import { ChatThread } from './chat/chat-thread'
import { Composer } from './chat/composer'
import { useTaskViewed } from './chat/use-task-viewed'
import { Button } from '@dovo/studio-ui'
export function TaskConversation({
  task,
  onReview,
  visible,
}: {
  task: Task
  onReview: () => void
  visible: boolean
}) {
  const [pending, setPending] = useApplicationState<PendingMessage | null>(null)
  const { id, messages, queue, turns, files, status } = task
  const visiblePending = useMemo(
    () => visiblePendingMessage({ id, messages, queue }, pending),
    [id, messages, queue, pending],
  )
  const displayedTask = useMemo(
    () => ({
      id,
      messages: visiblePending ? [...messages, visiblePending.message] : messages,
      queue,
      turns,
      files,
      status,
    }),
    [id, messages, queue, turns, files, status, visiblePending],
  )
  const viewed = useTaskViewed(task, visible)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatThread task={displayedTask} onReview={onReview} pending={visiblePending} />
      {viewed.error && (
        <div role="status" className="flex items-center gap-2 px-5 text-xs text-muted-foreground">
          <span title={viewed.error}>Couldn’t update read status.</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={viewed.retry}>
            Retry
          </Button>
        </div>
      )}
      {task.status === 'running' && task.runPhase === 'preparing' && (
        <div
          role="status"
          className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
        >
          {task.execution === 'worktree' ? (
            <GitFork className="size-4" />
          ) : (
            <Folder className="size-4" />
          )}
          <span className="flex-1">
            {task.execution === 'worktree' ? 'Preparing worktree' : 'Preparing checkout'}
            {task.setupCommand ? ' and running setup' : ''}…
          </span>
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
        </div>
      )}
      <TaskQuestions taskId={task.id} />
      <RunControls task={task} />
      <MessageQueue task={task} />
      <Composer key={task.id} task={task} onPending={setPending} />
    </div>
  )
}
