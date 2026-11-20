import { useQuestionRecovery } from '@dovo/studio-core'
import { useRef, useState } from 'react'
import { QuestionAttachments } from './question-attachments'
import {
  questionAllowsAttachments,
  type PendingQuestion,
  type QuestionAttachments as AnswerFiles,
} from '@dovo/protocol'
import { taskInputVisible } from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { QuestionForm } from '@dovo/studio-ui'
import { Schema } from 'effect'
import { mutableStruct, questionRecoveryDraft } from '@dovo/protocol'
/** An explicit request ID never falls back to another request. */
function selectTaskQuestion<T extends { id: string; prompt: { blocking?: boolean } }>(
  questions: readonly T[],
  questionId: string | undefined,
) {
  if (questionId) return questions.find((q) => q.id === questionId)
  return questions.find((q) => q.prompt.blocking !== false) ?? questions[0]
}

export function TaskQuestions({
  taskId,
  questionId,
  questionNavigation,
  onUseDraft,
}: {
  taskId: string
  questionId?: string
  /** Changes with each explicit navigation, so a repeated link asks for consent again. */
  questionNavigation?: string
  onUseDraft: (text: string, done: () => void) => void
}) {
  const { snapshot, connection, connected } = useWorkspace()
  // An explicit request opens only that request. "Show pending questions" releases it for this
  // navigation only. Another request, a new navigation or another thread or computer ends it.
  const owner = JSON.stringify([connection?.runtimeId, connection?.address, taskId])
  const [released, setReleased] = useState<{
    id: string
    navigation: string | undefined
    owner: string
  }>()
  if (released && (released.id !== questionId || released.owner !== owner)) setReleased(undefined)
  const target =
    questionId &&
    !(
      released?.id === questionId &&
      released.navigation === questionNavigation &&
      released.owner === owner
    )
      ? questionId
      : undefined
  const questions =
    snapshot?.questions.filter((q) => taskInputVisible(snapshot.workspace.tasks, taskId, q)) ?? []
  const recovery = (
    <RecoveredAnswers
      taskId={taskId}
      pendingIds={questions.map((q) => q.id)}
      onUseDraft={onUseDraft}
    />
  )
  const exact = selectTaskQuestion(questions, target)
  if (target && !exact)
    return (
      <div className="mx-auto w-full max-w-[var(--chat-max)] shrink-0 space-y-2 px-5 pb-2">
        {recovery}
        <div
          role="status"
          data-request-kind="input"
          data-request-id={target}
          tabIndex={-1}
          className="space-y-2 rounded-xl border px-3 py-2.5 text-xs"
        >
          <p>
            {connected
              ? 'This question has already been answered or is no longer pending.'
              : 'Reconnect to check this question.'}
          </p>
          {questions.length > 0 && (
            <button
              type="button"
              className="underline"
              onClick={() => setReleased({ id: target, navigation: questionNavigation, owner })}
            >
              Show pending questions ({questions.length})
            </button>
          )}
        </div>
      </div>
    )
  const pending = exact
  if (!pending) return recovery
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
      {pending.id === target && (
        <p
          data-request-kind="input"
          data-request-id={pending.id}
          tabIndex={-1}
          className="pb-1 text-xs font-medium"
        >
          {pending.prompt.title}
        </p>
      )}
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
  const preparations = useRef(new Map<string, () => Promise<void>>())
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
            onPrepare={(prepare) => {
              if (prepare) preparations.current.set(q.id, prepare)
              else preparations.current.delete(q.id)
            }}
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
        if (answers && !outcomes) {
          await Promise.all([...preparations.current.values()].map((prepare) => prepare()))
          const latest = store
            .entries(scope)
            .find(
              (entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId,
            )
          if (latest !== saved)
            throw new Error(
              'The answer changed while preparing attachments. Review it and try again.',
            )
        }
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

function RecoveredAnswers({
  taskId,
  pendingIds,
  onUseDraft,
}: {
  taskId: string
  pendingIds: string[]
  onUseDraft: (text: string, done: () => void) => void
}) {
  const { scope, store } = useQuestionRecovery()
  const { request, connected, snapshot } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
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
            This request is no longer pending. Use in draft appends these answers and available
            files to your saved draft.
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
            className="mr-3 text-xs underline"
            disabled={
              busy ||
              !connected ||
              (!!questionRecoveryDraft(entry).ids.length && !snapshot?.questionDraftReuseSupported)
            }
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const { text, ids } = questionRecoveryDraft(entry)
                if (ids.length) {
                  const { guard } = await request(
                    '/api/attachments/draft-guard',
                    { taskId },
                    mutableStruct({ guard: Schema.String }),
                  )
                  await request(
                    '/api/attachments/reuse-draft',
                    { taskId, ids, guard },
                    responses.ok,
                  )
                }
                if (!store.entries(scope).includes(entry))
                  throw new Error('Saved answers changed. Review them and try again.')
                onUseDraft(text, () => store.remove(scope, taskId, entry.request.id, entry))
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
              } finally {
                setBusy(false)
              }
            }}
          >
            Use in draft
          </button>
          {!!questionRecoveryDraft(entry).ids.length && !snapshot?.questionDraftReuseSupported && (
            <p className="text-xs text-muted-foreground">
              Update this computer to reuse saved files.
            </p>
          )}
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
