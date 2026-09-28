import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { MessageCircleQuestion, LoaderCircle } from 'lucide-react'
import {
  questionAnswerError,
  questionDraftAnswers,
  toggleQuestionChoice,
  type QuestionAnswers,
  type QuestionDraft,
  type PendingQuestion,
} from '@dovo/protocol'
import { QuestionField } from './question-field'
import { Button } from './components/ui/button'
export function QuestionForm({
  request,
  connected,
  onAnswer,
}: {
  request: PendingQuestion
  connected: boolean
  onAnswer: (answers: QuestionAnswers | null) => Promise<void>
}) {
  const [drafts, setDrafts] = useApplicationState<Record<string, QuestionDraft>>(() =>
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
  const submitting = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !connected ||
        busy ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element) ||
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
        ) ||
        document.querySelector('form[aria-label="Agent questions"]') !== form.current
      )
        return
      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index > 8) return
      const question = request.prompt.questions[0]
      const option = question?.options[index]
      if (!question || !option) return
      event.preventDefault()
      setDrafts((current) => ({
        ...current,
        [question.id]: toggleQuestionChoice(question, current[question.id], option.value),
      }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [request, connected, busy])
  const submit = async (answers: QuestionAnswers | null) => {
    if (submitting.current || !connected) return
    const invalid = answers && questionAnswerError(request.prompt.questions, answers)
    if (invalid) {
      setError(invalid)
      return
    }
    submitting.current = true
    setError('')
    setBusy(true)
    try {
      await onAnswer(answers)
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
      className="overflow-hidden rounded-xl border bg-card shadow-xs"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(questionDraftAnswers(drafts))
      }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <MessageCircleQuestion className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap font-medium">
          {request.prompt.title}
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[0.625rem] text-muted-foreground">
          {request.prompt.blocking === false ? 'Answer when ready' : 'Needs input'}
        </span>
      </div>
      <div className="max-h-64 space-y-4 overflow-auto p-3">
        {request.prompt.questions.map((q, index) => (
          <QuestionField
            key={q.id}
            question={q}
            value={drafts[q.id]}
            disabled={busy || !connected}
            shortcutNumbers={index === 0}
            onChange={(draft) => {
              setDrafts((current) => ({
                ...current,
                [q.id]: draft,
              }))
              setError('')
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !connected}>
          {busy && <LoaderCircle className="size-3 animate-spin" />}Send answers
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={busy || !connected}
          onClick={() => void submit(null)}
        >
          Decline
        </Button>
        {!connected && (
          <span className="text-[0.625rem] text-muted-foreground">Reconnect to answer</span>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
