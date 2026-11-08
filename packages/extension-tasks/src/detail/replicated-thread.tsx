import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  mergeThreadReplicaPage,
  threadReplicaPageSchema,
  responses,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Conversation,
  ConversationContent,
  ConversationHistory,
  ConversationScrollButton,
  Input,
  useConversationHistory,
} from '@dovo/studio-ui'
import { DeferredTurn } from '../chat/thread/deferred-turn'
import { TurnWindow, TurnWindowContext } from '../chat/thread/turn-window'

type Message = Task['messages'][number]
/** Records the reader's scroll position immediately before older messages are prepended. */
type PrependAnchor = RefObject<(() => void) | null>

/**
 * How a late older page relates to the current window. The cursor is the window's oldest message,
 * so a gap reset, a newest-page reload or a history rewrite while the page loaded changes it.
 * Attaching the old window's page and cursor to a new window would hide the gap from paging.
 */
type OlderReplicaPageFit = 'apply' | 'window-changed' | 'newer-revision'
function olderReplicaPageFit(current: Task, page: Task, cursor: string): OlderReplicaPageFit {
  const revision = current.historyRevision ?? 0
  const pageRevision = page.historyRevision ?? 0
  // The owner rewrote history after this window loaded; only its newest page can restart it.
  if (pageRevision > revision) return 'newer-revision'
  return pageRevision === revision && current.historyBefore === cursor ? 'apply' : 'window-changed'
}
/** Apply an older page only to the window whose cursor requested it. */
function applyOlderReplicaPage(current: Task, page: Task, cursor: string) {
  return olderReplicaPageFit(current, page, cursor) === 'apply'
    ? mergeThreadReplicaPage(current, page, true)
    : current
}
/** True when a merge replaced the loaded window instead of extending it. */
function replacedReplicaWindow(previous: readonly Message[], next: readonly Message[]) {
  const last = previous.at(-1)?.id
  return !!last && !!next.length && !next.some((message) => message.id === last)
}

/**
 * Distant messages unmount but keep their measured height, as in owned conversations. Prepended
 * pages keep the reader's distance from the end: browsers skip native scroll anchoring at the
 * very top, which would otherwise leave the reader at the start and load page after page. A
 * replaced window returns the reader to its newest message.
 */
function ReplicaMessages({ messages, anchor }: { messages: Message[]; anchor: PrependAnchor }) {
  const { scrollRef } = useConversationHistory()
  const pending = useRef<{ height: number; top: number; first: string } | null>(null)
  const shown = useRef(messages)
  useLayoutEffect(() => {
    anchor.current = () => {
      const root = scrollRef.current
      const first = shown.current[0]?.id
      pending.current =
        root && first ? { height: root.scrollHeight, top: root.scrollTop, first } : null
    }
    return () => {
      anchor.current = null
    }
  }, [anchor, scrollRef])
  useLayoutEffect(() => {
    const root = scrollRef.current
    const kept = pending.current
    const previous = shown.current
    shown.current = messages
    if (previous === messages) return
    pending.current = null
    if (!root) return
    if (replacedReplicaWindow(previous, messages)) {
      root.scrollTop = root.scrollHeight
      return
    }
    // Restore only for a real prepend: the previous first message moved further down.
    if (
      kept &&
      messages[0]?.id !== kept.first &&
      messages.some((message) => message.id === kept.first)
    )
      root.scrollTop = kept.top + root.scrollHeight - kept.height
  }, [messages, scrollRef])
  const latest = messages.length - 2
  return messages.map((message, index) => (
    <article key={message.id}>
      <DeferredTurn id={message.id} pinned={index >= latest}>
        {() => (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              {message.role === 'user' ? 'You' : 'Assistant'}
            </p>
            <div className="whitespace-pre-wrap break-words text-sm">{message.text}</div>
          </div>
        )}
      </DeferredTurn>
    </article>
  ))
}

export function ReplicatedThread({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const [view, setView] = useState(task)
  // Without a local edit the field follows the shared title, including remote renames.
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const title = titleDraft ?? view.title
  const [busy, setBusy] = useState(false)
  const [paging, setPaging] = useState(false)
  const pagingRef = useRef(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  // Pages load on reaching the start only after the reader leaves the newest messages, so a
  // first page that arrives before the scroller settles never pulls older history by itself.
  const [reading, setReading] = useState(false)
  const startReading = useCallback(() => setReading(true), [])
  const readGeneration = useRef(0)
  const turns = useMemo(() => new TurnWindow(), [])
  const anchor = useRef<(() => void) | null>(null)
  const shownView = useRef(view)
  useLayoutEffect(() => {
    shownView.current = view
  })
  const owner = task.replica
  useEffect(() => {
    setView((current) => mergeThreadReplicaPage(current, task))
  }, [task])
  useEffect(() => {
    if (!owner || !connected) return
    const generation = ++readGeneration.current
    let cancelled = false
    void request(
      '/api/threads/replica/read',
      { ownerRuntimeId: owner.ownerRuntimeId, threadId: owner.threadId },
      threadReplicaPageSchema,
    )
      .then(({ task: latest }) => {
        if (!cancelled && generation === readGeneration.current) {
          setView((current) => mergeThreadReplicaPage(current, latest))
          setError('')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === readGeneration.current)
          setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [owner?.ownerRuntimeId, owner?.threadId, task.historyRevision, reload, connected, request])
  const edit = async (field: 'title' | 'pinned', value: string | boolean) => {
    if (!owner || busy) return
    readGeneration.current++
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/threads/metadata',
        { ownerRuntimeId: owner.ownerRuntimeId, threadId: owner.threadId, field, value },
        responses.ok,
      )
      setView((current) => ({
        ...current,
        ...(field === 'title' && typeof value === 'string' ? { title: value } : {}),
        ...(field === 'pinned' && typeof value === 'boolean' ? { pinned: value } : {}),
      }))
      if (field === 'title') setTitleDraft(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const before = view.historyBefore
  const older = useCallback(async () => {
    // Scrolling near the start fires repeatedly while a page is in flight; request it once.
    if (!owner || !before || pagingRef.current) return
    pagingRef.current = true
    // Never cancel a newest-page read: it may carry a gap reset that supersedes this page.
    setPaging(true)
    setError('')
    try {
      const result = await request(
        '/api/threads/replica/read',
        { ownerRuntimeId: owner.ownerRuntimeId, threadId: owner.threadId, before },
        threadReplicaPageSchema,
      )
      const fit = olderReplicaPageFit(shownView.current, result.task, before)
      if (fit === 'newer-revision') setReload((value) => value + 1)
      if (fit !== 'apply') return
      anchor.current?.()
      // The updater checks again against updates that are not committed yet.
      setView((current) => applyOlderReplicaPage(current, result.task, before))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pagingRef.current = false
      setPaging(false)
    }
  }, [owner?.ownerRuntimeId, owner?.threadId, before, request])
  const loadEarlier = useCallback(() => void older(), [older])
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Shared thread">
      <header className="space-y-3 border-b p-4">
        <h1 className="font-semibold">{view.title}</h1>
        <p className="text-sm text-muted-foreground">
          {owner?.projectName} · {owner?.ownerName} · {view.status}
        </p>
        <p className="text-sm text-muted-foreground">
          Shared conversation. Agent execution stays on {owner?.ownerName}.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void edit('title', title.trim())
          }}
        >
          <Input
            aria-label="Thread title"
            value={title}
            onChange={(event) => setTitleDraft(event.target.value)}
            disabled={!connected || busy}
            maxLength={2000}
          />
          <Button type="submit" disabled={!connected || busy || !title.trim()}>
            Save title
          </Button>
          <Button
            type="button"
            disabled={!connected || busy}
            onClick={() => void edit('pinned', !view.pinned)}
          >
            {view.pinned ? 'Unpin' : 'Pin'}
          </Button>
        </form>
        <Button
          type="button"
          disabled={!connected || busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh messages
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </header>
      <TurnWindowContext value={turns}>
        <Conversation className="min-h-0">
          <ConversationHistory
            onReadingHistory={startReading}
            // A failed page waits for the explicit button instead of retrying on every scroll.
            onLoadEarlier={
              reading && before && connected && !paging && !error ? loadEarlier : undefined
            }
          >
            <ConversationContent className="gap-5 p-4">
              {before && (
                <Button
                  type="button"
                  className="self-start"
                  disabled={!connected || paging}
                  onClick={loadEarlier}
                >
                  Load older messages
                </Button>
              )}
              {paging && (
                <p role="status" className="text-xs text-muted-foreground">
                  Loading earlier messages…
                </p>
              )}
              <ReplicaMessages messages={view.messages} anchor={anchor} />
              {!view.messages.length && (
                <p className="text-sm text-muted-foreground">
                  Completed messages appear here after synchronization.
                </p>
              )}
            </ConversationContent>
          </ConversationHistory>
          <ConversationScrollButton />
        </Conversation>
      </TurnWindowContext>
    </section>
  )
}
