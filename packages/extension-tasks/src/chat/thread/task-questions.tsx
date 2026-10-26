import { taskInputVisible } from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { QuestionForm } from '@dovo/studio-ui'
export function TaskQuestions({ taskId }: { taskId: string }) {
  const { snapshot, request, connected } = useWorkspace()
  const questions =
    snapshot?.questions.filter((q) => taskInputVisible(snapshot.workspace.tasks, taskId, q)) ?? []
  if (!questions.length) return null
  const pending = questions.find((q) => q.prompt.blocking !== false) ?? questions[0]
  return (
    <div className="mx-auto w-full max-w-[var(--chat-max)] shrink-0 px-5 pb-2">
      {questions.length > 1 && (
        <p className="pb-1 text-[0.625rem] text-muted-foreground">
          {questions.length} requests waiting
        </p>
      )}
      {pending.taskId !== taskId && (
        <p className="pb-1 text-xs text-muted-foreground">
          For child thread ·{' '}
          {snapshot?.workspace.tasks.find((child) => child.id === pending.taskId)?.title ??
            pending.taskId}
        </p>
      )}
      <QuestionForm
        key={pending.id}
        request={pending}
        connected={connected}
        onAnswer={async (answers) => {
          await request('/api/tasks/answer', { id: pending.id, answers }, responses.ok)
        }}
      />
    </div>
  )
}
