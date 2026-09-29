import { useRef, useState } from 'react'
import { Schema } from 'effect'
import { GripHorizontal, MessageCircleQuestion, X } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
import { Button, MessageResponse, Textarea } from '@dovo/studio-ui'

const answerSchema = mutableStruct({ answer: Schema.String })

/** Ask about the thread ("what did it change in auth?") without adding to the conversation. */
export function SideQuestion({
  task,
  open,
  onOpenChange,
  onAddToComposer,
}: {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToComposer: (answer: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
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
  const close = () => {
    onOpenChange(false)
    setPosition(null)
  }
  const addToComposer = (answer: string) => {
    onAddToComposer(answer)
    close()
    requestAnimationFrame(() =>
      [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-task-id]')]
        .find((input) => input.dataset.taskId === task.id)
        ?.focus(),
    )
  }
  if (!open) return null
  return (
    <section
      role="dialog"
      aria-label="Side question"
      aria-modal="false"
      className="fixed z-50 flex max-h-[min(70dvh,680px)] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      style={position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }}
    >
      <div
        className="flex cursor-move touch-none items-center gap-2 border-b px-3 py-2"
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
          const rect = event.currentTarget.parentElement?.getBoundingClientRect()
          if (!rect) return
          drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const width = event.currentTarget.parentElement?.clientWidth ?? 420
          const height = event.currentTarget.parentElement?.clientHeight ?? 300
          setPosition({
            x: Math.max(
              8,
              Math.min(
                window.innerWidth - width - 8,
                drag.current.left + event.clientX - drag.current.x,
              ),
            ),
            y: Math.max(
              8,
              Math.min(
                window.innerHeight - height - 8,
                drag.current.top + event.clientY - drag.current.y,
              ),
            ),
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <GripHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
        <MessageCircleQuestion className="size-4" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-medium">Side question</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 cursor-pointer"
          aria-label="Close side question"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
      <p className="px-3 pt-2 text-xs text-muted-foreground">
        Ask about this thread without interrupting the agent.
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {answers.map((entry, index) => (
          <div key={index} className="space-y-1">
            <p className="text-xs font-medium">{entry.question}</p>
            <Button size="sm" variant="ghost" onClick={() => addToComposer(entry.question)}>
              Add question to composer
            </Button>
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <MessageResponse>{entry.answer}</MessageResponse>
            </div>
            <Button size="sm" variant="ghost" onClick={() => addToComposer(entry.answer)}>
              Add answer to composer
            </Button>
          </div>
        ))}
      </div>
      <form
        className="space-y-2 border-t p-3"
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
    </section>
  )
}
