import { useApplicationState } from '@dovo/studio-core/state'
import { useRef } from 'react'
import { MessageCircleQuestion, LoaderCircle } from 'lucide-react'
import {
  questionAnswerError,
  questionDraftAnswers,
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
        {request.prompt.questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={drafts[q.id]}
            disabled={busy || !connected}
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
