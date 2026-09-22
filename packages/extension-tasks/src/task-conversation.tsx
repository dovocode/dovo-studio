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
  const viewed = useTaskViewed(task, visible)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatThread task={task} onReview={onReview} />
      {viewed.error && (
        <div role="status" className="flex items-center gap-2 px-5 text-xs text-muted-foreground">
          <span title={viewed.error}>Couldn’t update read status.</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={viewed.retry}>
            Retry
          </Button>
        </div>
      )}
      <TaskQuestions taskId={task.id} />
      <RunControls task={task} />
      <MessageQueue task={task} />
      <Composer key={task.id} task={task} />
    </div>
  )
}
