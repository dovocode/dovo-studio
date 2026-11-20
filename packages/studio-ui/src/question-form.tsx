import { SecretReferenceFields } from './secret-reference-fields'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, type ReactNode } from 'react'
import { MessageCircleQuestion, LoaderCircle } from 'lucide-react'
import {
  questionAnswerError,
  questionReferenceAnswers,
  defaultSecretReference,
  type QuestionSecretReferences,
  questionDraftAnswers,
  toggleQuestionChoice,
  type QuestionAnswers,
  type QuestionOutcomes,
  type QuestionAttachmentIds,
  type AgentQuestion,
  type QuestionDraft,
  type PendingQuestion,
} from '@dovo/protocol'
import { humanInputShortcutTarget } from './human-input-shortcuts'
import { QuestionField } from './question-field'
import { Button } from './components/ui/button'

/** Number keys choose options in the question that holds focus, or in the first question while
 * focus is elsewhere in the form. They never change a question the user is not in. */
function questionShortcutQuestion(
  questions: readonly AgentQuestion[],
  focusedQuestionId: string | null | undefined,
) {
  return focusedQuestionId
    ? questions.find((question) => question.id === focusedQuestionId)
    : questions[0]
}

function focusedQuestionId(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-question-id]')?.dataset.questionId
    : undefined
}
export function QuestionForm({
  request,
  connected,
  savedDrafts,
  onDraftsChange,
  onAnswered,
  onAnswer,
  attachmentIdsByQuestion = {},
  renderAttachments,
  attachmentsBusy = false,
}: {
  request: PendingQuestion
  connected: boolean
  savedDrafts?: Record<string, QuestionDraft>
  onDraftsChange?: (drafts: Record<string, QuestionDraft>) => void
  onAnswered?: () => void
  onAnswer: (
    answers: QuestionAnswers | null,
    outcomes?: QuestionOutcomes,
    references?: QuestionSecretReferences,
  ) => Promise<void>
  attachmentIdsByQuestion?: QuestionAttachmentIds
  renderAttachments?: (question: AgentQuestion, disabled: boolean) => ReactNode
  attachmentsBusy?: boolean
}) {
  const [localDrafts, setLocalDrafts] = useApplicationState<Record<string, QuestionDraft>>(() =>
      Object.fromEntries(
        request.prompt.questions.map((q) => [
          q.id,
          {
            selected: [],
            text: '',
          },
        ]),
      ),
    ),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const [references, setReferences] = useApplicationState<QuestionSecretReferences>({})
  const drafts = Object.fromEntries(
    request.prompt.questions.map((q) => [
      q.id,
      (!q.secret && savedDrafts?.[q.id]) || localDrafts[q.id] || { selected: [], text: '' },
    ]),
  )
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const setDrafts = (
    update: (current: Record<string, QuestionDraft>) => Record<string, QuestionDraft>,
  ) => {
    const next = update(draftsRef.current)
    draftsRef.current = next
    setLocalDrafts(next)
    onDraftsChange?.(next)
  }
  const submitting = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const [shortcutQuestionId, setShortcutQuestionId] = useApplicationState<string | undefined>(
    undefined,
  )
  const shortcutQuestion = questionShortcutQuestion(request.prompt.questions, shortcutQuestionId)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        busy ||
        attachmentsBusy ||
        event.shiftKey ||
        humanInputShortcutTarget(event) !== form.current
      )
        return
      if (event.key === 'Enter') {
        // Offline edits stay in the form. Sending waits for the runtime to confirm the request.
        if (!connected) return
        if (
          event.target instanceof Element &&
          event.target.closest('button, a, summary, [role="button"]')
        )
          return
        event.preventDefault()
        form.current?.requestSubmit()
        return
      }
      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index > 8) return
      const question = questionShortcutQuestion(
        request.prompt.questions,
        focusedQuestionId(event.target),
      )
      const option = question?.options[index]
      if (!question || !option) return
      event.preventDefault()
      setDrafts((current) => ({
        ...current,
        [question.id]: toggleQuestionChoice(question, current[question.id], option.value),
      }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [request, connected, busy, attachmentsBusy])
  const submit = async (answers: QuestionAnswers | null, outcomes?: QuestionOutcomes) => {
    if (submitting.current || !connected || attachmentsBusy) return
    const invalid =
      answers &&
      questionAnswerError(
        request.prompt.questions,
        questionReferenceAnswers(answers, outcomes ? {} : references),
        attachmentIdsByQuestion,
      )
    if (invalid) {
      setError(invalid)
      return
    }
    submitting.current = true
    setError('')
    setBusy(true)
    try {
      await onAnswer(answers, outcomes, answers && !outcomes ? references : {})
      if (answers && !outcomes) onAnswered?.()
    } catch (error) {
      setError(String(error))
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <form
      ref={form}
      aria-label="Agent questions"
      className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(questionDraftAnswers(drafts))
      }}
      onFocus={(event) => setShortcutQuestionId(focusedQuestionId(event.target))}
    >
      <div className="flex items-center gap-2.5 border-b border-border/60 bg-muted/20 px-4 py-3 text-xs">
        <MessageCircleQuestion className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap font-medium">
          {request.prompt.title}
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[0.625rem] text-muted-foreground">
          {request.prompt.blocking === false ? 'Answer when ready' : 'Needs input'}
        </span>
      </div>
      <div
        role="region"
        aria-label="Questions"
        tabIndex={0}
        className="max-h-[min(60dvh,28rem)] space-y-5 overflow-auto p-4"
      >
        {request.prompt.questions.map((q) => (
          <div key={q.id} data-question-id={q.id} className="space-y-2">
            <QuestionField
              question={Object.hasOwn(references, q.id) ? { ...q, custom: false, options: [] } : q}
              value={drafts[q.id]}
              // Offline edits stay recoverable. Only the actions that answer need the runtime.
              disabled={busy || attachmentsBusy}
              shortcutNumbers={shortcutQuestion?.id === q.id}
              onChange={(draft) => {
                setDrafts((current) => ({
                  ...current,
                  [q.id]: draft,
                }))
                setError('')
              }}
            />
            {request.secretReferences && q.secret && q.custom && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !connected}
                  onClick={() => {
                    setReferences((current) => {
                      const next = { ...current }
                      if (Object.hasOwn(next, q.id)) delete next[q.id]
                      else next[q.id] = defaultSecretReference('onepassword')
                      return next
                    })
                    setDrafts((current) => ({ ...current, [q.id]: { selected: [], text: '' } }))
                    setError('')
                  }}
                >
                  {Object.hasOwn(references, q.id)
                    ? 'Type secret instead'
                    : 'Use a secret reference'}
                </Button>
                {Object.hasOwn(references, q.id) && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      The computer reads this value and sends it to the agent’s secret response.
                      Dovo hides it from the activity log.
                    </p>
                    <SecretReferenceFields
                      value={references[q.id]}
                      disabled={busy || !connected}
                      onChange={(value) =>
                        setReferences((current) => ({ ...current, [q.id]: value }))
                      }
                    />
                  </div>
                )}
              </>
            )}
            {renderAttachments?.(q, busy || !connected || attachmentsBusy)}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={busy || !connected || attachmentsBusy}
          onClick={() => void submit(null)}
        >
          {request.prompt.unanswered ? 'Dismiss' : 'Decline'}
        </Button>
        {request.prompt.unanswered && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy || !connected || attachmentsBusy}
            onClick={() =>
              void submit(
                {},
                Object.fromEntries(request.prompt.questions.map((q) => [q.id, 'replied_in_chat'])),
              )
            }
          >
            I replied in chat
          </Button>
        )}
        {!connected && (
          <span role="status" className="text-[0.625rem] text-muted-foreground">
            Offline. You can keep editing. Reconnect to send.
          </span>
        )}
        <span className="flex-1" />
        <Button
          type="submit"
          size="sm"
          className="h-8 rounded-[10px] px-3 text-xs"
          disabled={busy || !connected || attachmentsBusy}
        >
          {busy && <LoaderCircle className="size-3 animate-spin" />}Send answers
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
