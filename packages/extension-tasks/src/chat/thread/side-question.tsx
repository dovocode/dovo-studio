import { useState } from 'react'
import { Schema } from 'effect'
import { Plus, Trash2 } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
import { Button, MessageResponse, Textarea } from '@dovo/studio-ui'

const answerSchema = mutableStruct({ answer: Schema.String })
const savedSchema = mutableStruct({ id: Schema.String })

/** Saved side conversations belong to the thread, separate from its agent session. */
export function SideQuestion({
  task,
  onAddToComposer,
}: {
  task: Task
  onAddToComposer: (text: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [selected, setSelected] = useState('')
  const chats = task.sideChats ?? []
  const chat = chats.find((item) => item.id === selected) ?? chats[0]
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const question = chat ? (drafts[chat.id] ?? chat.draft) : ''
  const disabled = !connected || !!task.archived || busy
  const asking =
    !!chat && (!!pending[chat.id] || chat.messages.some((item) => item.status === 'pending'))
  const perform = (run: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    void run()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <section aria-label="Side chats" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {chats.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={item.id === chat?.id ? 'secondary' : 'ghost'}
            className="h-7 max-w-40 truncate text-xs"
            onClick={() => setSelected(item.id)}
          >
            {item.title}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label="New side chat"
          onClick={() =>
            perform(async () => {
              const result = await request(
                '/api/tasks/side-chat/save',
                { id: task.id },
                savedSchema,
              )
              setSelected(result.id)
            })
          }
        >
          <Plus className="size-3.5" /> New chat
        </Button>
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Ask about this thread without interrupting its agent.
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!chat && (
          <p className="text-xs text-muted-foreground">Create a side chat to ask a question.</p>
        )}
        {chat?.messages.map((entry) => (
          <div key={entry.id} className="space-y-1">
            <p className="text-xs font-medium">{entry.question}</p>
            <Button size="sm" variant="ghost" onClick={() => onAddToComposer(entry.question)}>
              Add question to composer
            </Button>
            {entry.answer && (
              <>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <MessageResponse>{entry.answer}</MessageResponse>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAddToComposer(entry.answer ?? '')}
                >
                  Add answer to composer
                </Button>
              </>
            )}
            {entry.status === 'pending' && (
              <p role="status" className="text-xs text-muted-foreground">
                Asking…
              </p>
            )}
            {entry.error && (
              <p role="alert" className="text-xs text-destructive">
                {entry.error}
              </p>
            )}
          </div>
        ))}
      </div>
      {chat && (
        <form
          className="space-y-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !question.trim() ||
              disabled ||
              asking ||
              chat.messages.some((item) => item.status === 'pending')
            )
              return
            setPending((current) => ({ ...current, [chat.id]: true }))
            setError('')
            void (async () => {
              await request(
                '/api/tasks/side-chat/ask',
                { id: task.id, chatId: chat.id, question },
                answerSchema,
              )
              setDrafts((current) => ({ ...current, [chat.id]: '' }))
            })()
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setPending((current) => ({ ...current, [chat.id]: false })))
          }}
        >
          <Textarea
            aria-label="Side question"
            placeholder="What did the agent change so far?"
            value={question}
            maxLength={4000}
            disabled={disabled || asking}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [chat.id]: event.target.value }))
            }
            className="min-h-16 text-sm"
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || asking}
              onClick={() =>
                perform(() =>
                  request(
                    '/api/tasks/side-chat/save',
                    { id: task.id, chatId: chat.id, draft: question },
                    savedSchema,
                  ),
                )
              }
            >
              Save draft
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label="Delete side chat"
              onClick={() => {
                if (window.confirm('Delete this side chat?'))
                  perform(() =>
                    request(
                      '/api/tasks/side-chat/save',
                      { id: task.id, chatId: chat.id, remove: true },
                      savedSchema,
                    ),
                  )
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                disabled ||
                !question.trim() ||
                chat.messages.some((item) => item.status === 'pending')
              }
            >
              Ask
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
