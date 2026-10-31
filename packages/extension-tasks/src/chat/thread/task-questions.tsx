import { useState } from 'react'
import { QuestionAttachments } from './question-attachments'
import {
  questionAllowsAttachments,
  type PendingQuestion,
  type QuestionAttachments as AnswerFiles,
} from '@dovo/protocol'
import { taskInputVisible } from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { QuestionForm } from '@dovo/studio-ui'
export function TaskQuestions({ taskId }: { taskId: string }) {
  const { snapshot, connection } = useWorkspace()
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
      <QuestionCard
        key={JSON.stringify([
          connection?.runtimeId,
          connection?.address,
          pending.taskId,
          pending.id,
        ])}
        pending={pending}
      />
    </div>
  )
}

function QuestionCard({ pending }: { pending: PendingQuestion }) {
  const { request, connected } = useWorkspace()
  const [files, setFiles] = useState<AnswerFiles>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const ids = Object.fromEntries(
    Object.entries(files).map(([id, files]) => [id, files.map((file) => file.id)]),
  )
  const count = Object.values(files).flat().length
  return (
    <QuestionForm
      request={pending}
      connected={connected}
      attachmentIdsByQuestion={ids}
      attachmentsBusy={Object.values(uploading).some(Boolean)}
      renderAttachments={(q, disabled) =>
        pending.attachments && questionAllowsAttachments(q) ? (
          <QuestionAttachments
            taskId={pending.taskId}
            questionId={`${pending.id}:${q.id}`}
            files={Object.hasOwn(files, q.id) ? files[q.id] : []}
            count={count}
            disabled={disabled}
            onAdd={(file) => {
              setFiles((current) => ({
                ...current,
                [q.id]: [...(Object.hasOwn(current, q.id) ? current[q.id] : []), file],
              }))
              return true
            }}
            onRemove={(id) =>
              setFiles((current) => ({
                ...current,
                [q.id]: (Object.hasOwn(current, q.id) ? current[q.id] : []).filter(
                  (file) => file.id !== id,
                ),
              }))
            }
            onBusy={(busy) =>
              setUploading((current) =>
                current[q.id] === busy ? current : { ...current, [q.id]: busy },
              )
            }
          />
        ) : null
      }
      onAnswer={async (answers) => {
        await request(
          '/api/tasks/answer',
          { id: pending.id, answers, ...(answers ? { attachmentIdsByQuestion: ids } : {}) },
          responses.ok,
        )
      }}
    />
  )
}
