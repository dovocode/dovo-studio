import { useState } from 'react'
import { Schema } from 'effect'
import { MessageCircleQuestion } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  MessageResponse,
  Textarea,
} from '@dovo/studio-ui'

const answerSchema = mutableStruct({ answer: Schema.String })

/** Ask about the thread ("what did it change in auth?") without adding to the conversation. */
export function SideQuestion({
  task,
  open,
  onOpenChange,
}: {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { request, connected } = useWorkspace()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ask = () => {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    void request('/api/tasks/aside', { id: task.id, question: text }, answerSchema)
      .then((result) => {
        setAnswers((current) => [...current, { question: text, answer: result.answer }])
        setQuestion('')
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="flex max-h-[80dvh] max-w-2xl flex-col gap-3">
        <DialogTitle className="flex items-center gap-2 text-sm">
          <MessageCircleQuestion className="size-4" /> Side question
        </DialogTitle>
        <DialogDescription className="text-xs">
          Answered from this conversation by your title model. Nothing is added to the thread and
          the agent keeps working.
        </DialogDescription>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {answers.map((entry, index) => (
            <div key={index} className="space-y-1">
              <p className="text-xs font-medium">{entry.question}</p>
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <MessageResponse>{entry.answer}</MessageResponse>
              </div>
            </div>
          ))}
        </div>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            ask()
          }}
        >
          <Textarea
            autoFocus
            aria-label="Side question"
            placeholder="What did the agent change so far?"
            value={question}
            maxLength={4000}
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                ask()
              }
            }}
            className="min-h-16 text-sm"
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!connected || busy || !question.trim()}>
              {busy ? 'Asking…' : 'Ask'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
