import { responses, useWorkspace } from '@dovo/studio-core'
import { QuestionForm } from '@dovo/studio-ui'
export function TaskQuestions({ taskId }: { taskId: string }) {
  const { snapshot, request, connected } = useWorkspace()
  const questions = snapshot?.questions.filter((q) => q.taskId === taskId) ?? []
  if (!questions.length) return null
  const pending = questions.find((q) => q.prompt.blocking !== false) ?? questions[0]
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-2">
      {questions.length > 1 && (
        <p className="pb-1 text-[0.625rem] text-muted-foreground">
          {questions.length} requests waiting
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
