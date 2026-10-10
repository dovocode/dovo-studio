import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Schema } from 'effect'
import { ArrowUp, CornerDownLeft, MoreHorizontal, Plus, RotateCcw } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  Input,
  MessageResponse,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@dovo/studio-ui'

const answerSchema = mutableStruct({ answer: Schema.String })
const savedSchema = mutableStruct({ id: Schema.String })

/** Saved side conversations stay separate from the thread's coding-agent session. */
export function SideQuestion({
  task,
  onAddToComposer,
  drafts,
  setDrafts,
}: {
  task: Task
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
  onAddToComposer: (text: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [selected, setSelected] = useState('')
  const chats = task.sideChats ?? []
  const chat = chats.find((item) => item.id === selected) ?? chats[0]
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const pendingRequests = useRef(new Set<string>())
  const actionPending = useRef(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState('')
  const [askErrors, setAskErrors] = useState<Record<string, string>>({})
  const [savedDraft, setSavedDraft] = useState('')
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const [title, setTitle] = useState('')
  const question = chat ? (drafts[chat.id] ?? chat.draft) : ''
  useEffect(() => {
    setDrafts((current) => {
      const acknowledged = chats.filter((item) => current[item.id] === item.draft)
      if (!acknowledged.length) return current
      const next = { ...current }
      for (const item of acknowledged) delete next[item.id]
      return next
    })
  }, [task.sideChats, setDrafts])
  const readOnly = !!task.archived || !!task.archivedAt
  const disabled = !connected || readOnly || busy
  const asking =
    !!chat && (!!pending[chat.id] || chat.messages.some((item) => item.status === 'pending'))
  useEffect(() => {
    setError('')
    composer.current?.focus()
  }, [chat?.id])
  const perform = async (run: () => Promise<void>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }
  const create = () =>
    void perform(async () => {
      const result = await request('/api/tasks/side-chat/save', { id: task.id }, savedSchema)
      setSelected(result.id)
    })
  const ask = async () => {
    if (!chat || !question.trim() || disabled || asking || pendingRequests.current.has(chat.id))
      return
    const chatId = chat.id
    pendingRequests.current.add(chatId)
    setPending((current) => ({ ...current, [chatId]: true }))
    setAskErrors((current) => ({ ...current, [chatId]: '' }))
    setSavedDraft('')
    try {
      await request('/api/tasks/side-chat/ask', { id: task.id, chatId, question }, answerSchema)
      setDrafts((current) => ({ ...current, [chatId]: '' }))
    } catch (cause) {
      setAskErrors((current) => ({
        ...current,
        [chatId]: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      pendingRequests.current.delete(chatId)
      setPending((current) => ({ ...current, [chatId]: false }))
    }
  }
  const transfer = (text: string) =>
    void perform(async () => {
      // Keep unfinished questions when moving back to the main composer.
      if (!readOnly)
        for (const item of chats) {
          const draft = drafts[item.id]
          if (
            draft !== undefined &&
            draft !== item.draft &&
            !pendingRequests.current.has(item.id) &&
            !item.messages.some((message) => message.status === 'pending')
          )
            await request(
              '/api/tasks/side-chat/save',
              { id: task.id, chatId: item.id, draft },
              savedSchema,
            )
        }
      onAddToComposer(text)
    })
  return (
    <section aria-label="Side chats" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          {chat ? (
            <Select value={chat.id} onValueChange={setSelected}>
              <SelectTrigger aria-label="Side chat" className="border-0 shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chats.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h2 className="text-sm font-medium">Side chats</h2>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          disabled={disabled || chats.length >= 20}
          aria-label="New side chat"
          title="New side chat"
          onClick={create}
        >
          <Plus className="size-4" />
        </Button>
        {chat && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label="Side chat options"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 min-w-36 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
              >
                <DropdownMenu.Item
                  className="cursor-default rounded-sm px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => {
                    setTitle(chat.title)
                    setDialog('rename')
                  }}
                >
                  Rename chat
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="cursor-default rounded-sm px-2 py-1.5 text-destructive outline-none focus:bg-accent"
                  onSelect={() => setDialog('delete')}
                >
                  Delete chat
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Uses this thread as context. Your coding agent keeps working.
      </p>
      <Conversation
        key={chat?.id ?? 'empty'}
        className="min-h-0"
        aria-label="Side chat conversation"
      >
        <ConversationContent className="space-y-5 px-4 py-3">
          {!chat && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <h3 className="text-sm font-medium">A question on the side</h3>
              <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
                Discuss a decision or ask for an explanation. Answers stay here until you add them
                to the main thread.
              </p>
              <Button variant="outline" size="sm" disabled={disabled} onClick={create}>
                <Plus className="size-4" />
                New side chat
              </Button>
            </div>
          )}
          {chat && !chat.messages.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              What would you like to understand about this thread?
            </p>
          )}
          {chat?.messages.map((entry) => (
            <div key={entry.id} className="space-y-3">
              <div className="group ml-6 flex flex-col items-end gap-1">
                <p className="max-w-full whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm">
                  {entry.question}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  aria-label="Add question to main thread"
                  disabled={busy || !connected}
                  onClick={() => transfer(entry.question)}
                >
                  <CornerDownLeft className="size-3" />
                  Add to thread
                </Button>
              </div>
              {entry.answer && (
                <div className="space-y-1 text-sm">
                  <MessageResponse>{entry.answer}</MessageResponse>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    aria-label="Add answer to main thread"
                    disabled={busy || !connected}
                    onClick={() => transfer(entry.answer ?? '')}
                  >
                    <CornerDownLeft className="size-3" />
                    Add to thread
                  </Button>
                </div>
              )}
              {entry.status === 'pending' && (
                <p role="status" className="text-xs text-muted-foreground">
                  Thinking…
                </p>
              )}
              {entry.error && (
                <div className="space-y-1">
                  <p role="alert" className="text-xs text-destructive">
                    {entry.error}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || asking}
                    onClick={() => {
                      setDrafts((current) => ({ ...current, [chat.id]: entry.question }))
                      composer.current?.focus()
                    }}
                  >
                    <RotateCcw className="size-3" />
                    Try this question again
                  </Button>
                </div>
              )}
            </div>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {(error || (chat && askErrors[chat.id])) && !dialog && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error || (chat && askErrors[chat.id])}
        </p>
      )}
      {chat && (
        <form
          className="space-y-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          <div className="rounded-xl border bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              ref={composer}
              aria-label="Side question"
              placeholder="Ask about this thread…"
              value={question}
              maxLength={4000}
              disabled={disabled || asking}
              onChange={(event) => {
                setSavedDraft('')
                setDrafts((current) => ({ ...current, [chat.id]: event.target.value }))
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              className="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || asking || question === chat.draft}
                onClick={() =>
                  void perform(async () => {
                    await request(
                      '/api/tasks/side-chat/save',
                      { id: task.id, chatId: chat.id, draft: question },
                      savedSchema,
                    )
                    setSavedDraft(chat.id)
                  })
                }
              >
                Save draft
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={disabled || asking || !question.trim()}
                aria-label="Send side question"
                title="Send side question"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
          <p role="status" className="text-center text-[11px] text-muted-foreground">
            {!connected
              ? 'Reconnect this computer to ask a question.'
              : readOnly
                ? 'Reopen this thread to continue its side chats.'
                : savedDraft === chat.id
                  ? 'Draft saved with this thread.'
                  : 'Ctrl / ⌘ + Enter to send · Answers stay separate from the main thread.'}
          </p>
        </form>
      )}
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogTitle>
            {dialog === 'delete' ? 'Delete side chat?' : 'Rename side chat'}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'delete'
              ? `“${chat?.title}” and its saved questions and answers will be permanently deleted.`
              : 'Give this conversation a name you can find later.'}
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!chat || disabled || (dialog === 'rename' && !title.trim())) return
              void perform(async () => {
                await request(
                  '/api/tasks/side-chat/save',
                  {
                    id: task.id,
                    chatId: chat.id,
                    ...(dialog === 'delete' ? { remove: true } : { title: title.trim() }),
                  },
                  savedSchema,
                )
                if (dialog === 'delete') {
                  setSelected(chats.find((item) => item.id !== chat.id)?.id ?? '')
                  setDrafts((current) => {
                    const next = { ...current }
                    delete next[chat.id]
                    return next
                  })
                }
                setDialog(null)
              })
            }}
            className="space-y-3"
          >
            {dialog === 'rename' && (
              <Input
                aria-label="Side chat name"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                autoFocus
              />
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={dialog === 'delete' ? 'destructive' : 'default'}
                disabled={disabled || (dialog === 'rename' && !title.trim())}
              >
                {dialog === 'delete' ? 'Delete chat' : 'Save name'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
