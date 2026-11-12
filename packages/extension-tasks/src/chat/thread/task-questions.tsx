import { useQuestionRecovery } from '@dovo/studio-core'
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
  const recovery = <RecoveredAnswers taskId={taskId} pendingIds={questions.map((q) => q.id)} />
  if (!questions.length) return recovery
  const pending = questions.find((q) => q.prompt.blocking !== false) ?? questions[0]
  return (
    <div
      className="mx-auto w-full max-w-[var(--chat-max)] shrink-0 px-5 pb-2"
      data-human-input="question"
      data-human-input-task={taskId}
    >
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
      {recovery}
      <QuestionCard
        key={JSON.stringify([
          connection?.runtimeId,
          connection?.address,
          connection?.token,
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
  const { scope, store } = useQuestionRecovery()
  const saved = store
    .entries(scope)
    .find((entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId)
  const files = saved?.files ?? {}
  const setFiles = (update: (files: AnswerFiles) => AnswerFiles) =>
    store.update(
      scope,
      pending,
      undefined,
      update(
        store
          .entries(scope)
          .find(
            (entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId,
          )?.files ?? {},
      ),
    )
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const ids = Object.fromEntries(
    Object.entries(files).map(([id, files]) => [id, files.map((file) => file.id)]),
  )
  const count = Object.values(files).flat().length
  return (
    <QuestionForm
      request={pending}
      savedDrafts={saved?.drafts}
      onDraftsChange={(drafts) => store.update(scope, pending, drafts)}
      onAnswered={() => {
        if (
          store
            .entries(scope)
            .find(
              (entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId,
            ) === saved
        )
          store.remove(scope, pending.taskId, pending.id, saved ?? null)
      }}
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
      onAnswer={async (answers, outcomes, references) => {
        await request(
          '/api/tasks/answer',
          {
            id: pending.id,
            answers,
            outcomes,
            secretReferencesByQuestion: references,
            ...(answers && !outcomes ? { attachmentIdsByQuestion: ids } : {}),
          },
          responses.ok,
        )
      }}
    />
  )
}

function RecoveredAnswers({ taskId, pendingIds }: { taskId: string; pendingIds: string[] }) {
  const { scope, store } = useQuestionRecovery()
  const entries = store
    .entries(scope)
    .filter(
      (entry) =>
        entry.request.taskId === taskId &&
        !pendingIds.includes(entry.request.id) &&
        (Object.values(entry.drafts).some((draft) => draft.text || draft.selected.length) ||
          Object.values(entry.files).some((files) => files.length)),
    )
  return (
    <div className="mx-auto w-full max-w-[var(--chat-max)] space-y-2 px-5 pb-2">
      {store.error(scope) && (
        <p role="alert" className="text-xs text-destructive">
          {store.error(scope)}{' '}
          <button type="button" className="underline" onClick={() => void store.retry(scope)}>
            Retry saved answers
          </button>
        </p>
      )}
      {entries.map((entry) => (
        <details key={entry.request.id} className="rounded-xl border p-3">
          <summary>Saved answers · {entry.request.prompt.title}</summary>
          <p className="py-2 text-xs text-muted-foreground">
            This request is no longer pending. Select and copy the answers you want to keep.
          </p>
          {entry.request.prompt.questions
            .filter((q) => !q.secret)
            .map((q) => (
              <div key={q.id} className="space-y-1 py-2">
                <p className="text-xs">{q.question}</p>
                <textarea
                  aria-label={`Saved answer: ${q.question}`}
                  readOnly
                  className="w-full rounded border p-2 text-sm"
                  value={[...(entry.drafts[q.id]?.selected ?? []), entry.drafts[q.id]?.text ?? '']
                    .filter(Boolean)
                    .join('\n')}
                />
                {(entry.files[q.id] ?? []).map((file) => (
                  <p key={file.id} className="select-text text-xs">
                    Attachment: {file.name} ({file.id})
                  </p>
                ))}
              </div>
            ))}
          <button
            type="button"
            className="text-xs underline"
            onClick={() => store.remove(scope, taskId, entry.request.id)}
          >
            Discard saved answers
          </button>
        </details>
      ))}
    </div>
  )
}
