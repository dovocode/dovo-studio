import { useConversationHistory } from './use-conversation-history'
import { ChatMessage } from './chat-message'
import { DeferredTurn } from './deferred-turn'
import {
  threadPullLink,
  conversationMessageTurns,
  conversationToolsByMessage,
  type PendingMessage,
  conversationPageSchema,
  taskTranscript,
  type ConversationPage,
  responses,
} from '@dovo/protocol'
import { TurnWork } from './turn-work'
import { PullLinkActions } from './pull-link-actions'
import { ThreadLinkMenu } from './thread-link-menu'
import { conversationTurns, conversationTurnLabel } from './conversation-turns'
import { useThreadSearch } from './use-thread-search'
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { TaskActivity, useTaskActivity } from './task-activity'
import { Star, ChevronUp, ChevronDown, X } from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationHistory,
  ConversationRail,
  ConversationScrollButton,
  Button,
  IconButton,
} from '@dovo/studio-ui'
import type { Task } from '@dovo/studio-core'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
const emptyTools: ReturnType<typeof useTaskActivity>['tools'] = []
const emptyCompactions: NonNullable<Task['compactions']> = []
export function ChatThread({
  task: liveTask,
  onTerminal,
  pending,
  onBrowser,
  onPullLink,
  revealMessage,
  onRevealHandled,
  onManagePulls,
  onReadingHistory,
}: {
  task: Pick<Task, 'id' | 'messages' | 'turns' | 'status' | 'queue' | 'compactions'> & {
    historyBefore: Task['historyBefore']
    historyRevision: Task['historyRevision']
  }
  /** Shows the terminal after a chat command ran in it. */
  onTerminal?: (terminalId: string) => void
  pending?: PendingMessage | null
  onBrowser?: (url: string) => void
  onPullLink?: (url: string) => boolean
  revealMessage?: string
  onRevealHandled?: () => void
  onManagePulls?: () => void
  onReadingHistory?: () => void
}) {
  const history = useConversationHistory(liveTask)
  const task = history.task
  const { chooseLink, openPullLink } = useStudioHost()
  const [linkError, setLinkError] = useState('')
  const { request, connected, workspace, connection } = useWorkspace()
  const linkScope = JSON.stringify([connection?.address, connection?.token, liveTask.id])
  const [selectedPull, setSelectedPull] = useState<{ scope: string; url: string } | null>(null)
  const pull = selectedPull?.scope === linkScope ? threadPullLink(selectedPull.url) : null
  const fullTask = workspace.tasks.find((item) => item.id === liveTask.id)
  const copyThread = async () => {
    if (!task.historyBefore || !connected) {
      await navigator.clipboard.writeText(
        taskTranscript({ ...task, title: fullTask?.title ?? 'Thread' }),
      )
      return
    }
    const pages: ConversationPage[] = []
    let before: string | undefined
    do {
      const page = await request(
        '/api/tasks/history',
        { id: task.id, before },
        conversationPageSchema,
      )
      pages.unshift(page)
      before = page.before
    } while (before)
    await navigator.clipboard.writeText(
      taskTranscript({
        title: fullTask?.title ?? 'Thread',
        messages: pages.flatMap((page) => page.messages),
      }),
    )
  }
  const selectPull = (url: string) => {
    if (!fullTask || !threadPullLink(url)) return false
    setSelectedPull({ scope: linkScope, url })
    return true
  }
  const [bookmarkJump, setBookmarkJump] = useState('')
  useEffect(() => {
    if (!bookmarkJump) return
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(bookmarkJump)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [bookmarkJump])
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const open = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === task.id) {
        setSearchOpen(true)
        requestAnimationFrame(() => {
          searchInput.current?.focus()
          searchInput.current?.select()
        })
      }
    }
    window.addEventListener('dovo:search-thread', open)
    return () => window.removeEventListener('dovo:search-thread', open)
  }, [task.id])
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const filter = useDeferredValue(searchOpen ? query : '')
  const search = useThreadSearch(task, filter)
  const matches = search.matches
  const selectedMatch = matches[Math.min(matchIndex, Math.max(0, matches.length - 1))]
  const revealPrefix = `message-${task.id}-`
  const revealId = revealMessage?.startsWith(revealPrefix)
    ? revealMessage.slice(revealPrefix.length)
    : undefined
  const target = selectedMatch?.id ?? revealId
  const targetVisible = !!target && task.messages.some((message) => message.id === target)
  useEffect(() => {
    if (
      target &&
      !task.messages.some((message) => message.id === target) &&
      history.hasMore &&
      !history.busy &&
      !history.error &&
      connected
    )
      void history.load()
  }, [target, task.messages, history.hasMore, history.busy, history.error, history.load, connected])
  useEffect(() => {
    if (!target || !targetVisible) return
    let highlight: ReturnType<typeof setTimeout> | undefined
    let highlighted: HTMLElement | null = null
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`message-${task.id}-${target}`)
      element?.scrollIntoView({ behavior: revealId ? 'instant' : 'smooth', block: 'center' })
      if (element && target === revealId) {
        highlighted = element
        element.classList.add('studio-search-hit')
        highlight = setTimeout(() => {
          element.classList.remove('studio-search-hit')
          onRevealHandled?.()
        }, 1600)
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      if (highlight) clearTimeout(highlight)
      highlighted?.classList.remove('studio-search-hit')
    }
  }, [target, targetVisible, task.id, filter, revealId, onRevealHandled])
  const lastTurn = task.turns?.at(-1)
  const bookmarks = useMemo(
    () => task.messages.filter((message) => message.role === 'assistant' && message.bookmarked),
    [task.messages],
  )
  const activity = useTaskActivity(task.id, task.status === 'running')
  const turns = useMemo(() => conversationMessageTurns(task), [task.turns, task.messages])
  const retainActivityGroups = useMemo(() => {
    let previous = {
      byMessage: new Map<string, typeof emptyTools>(),
      byTurn: new Map<string, typeof emptyTools>(),
    }
    return (next: typeof previous) => {
      for (const kind of ['byMessage', 'byTurn'] as const)
        for (const [id, tools] of next[kind]) {
          const old = previous[kind].get(id)
          if (
            old &&
            old.length === tools.length &&
            old.every((tool, index) => tool === tools[index])
          )
            next[kind].set(id, old)
        }
      previous = next
      return next
    }
  }, [])
  const activityGroups = useMemo(() => {
    const visibleTurns = new Set(
      task.messages.flatMap((message) => {
        const turn = turns.get(message.id)
        return turn ? [turn.id] : []
      }),
    )
    const byMessage = conversationToolsByMessage(task, activity.tools)
    const byTurn = new Map<string, typeof emptyTools>()
    for (const tool of activity.tools) {
      if (!tool.turnId) continue
      const tools = byTurn.get(tool.turnId) ?? []
      tools.push(tool)
      byTurn.set(tool.turnId, tools)
    }
    const unassigned = activity.tools.filter(
      (tool) => !tool.turnId || !visibleTurns.has(tool.turnId),
    )
    return { ...retainActivityGroups({ byMessage, byTurn }), unassigned }
  }, [activity.tools, task.messages, turns, retainActivityGroups])
  const compactionsByMessage = useMemo(() => {
    const byTurn = new Map<string, NonNullable<Task['compactions']>>()
    for (const event of task.compactions ?? []) {
      const messageId =
        event.messageId ?? task.turns?.find((turn) => turn.id === event.turnId)?.assistantId
      if (!messageId) continue
      const events = byTurn.get(messageId) ?? []
      events.push(event)
      byTurn.set(messageId, events)
    }
    return byTurn
  }, [task.compactions, task.turns])
  const groups = useMemo(() => conversationTurns(task), [task.messages, task.turns])
  const markers = useMemo(
    () =>
      groups.map((group) => {
        const prompt =
          group.messages.find((message) => message.role === 'user') ?? group.messages[0]
        const response = group.messages
          .filter((message) => message.role === 'assistant' && message.text.trim())
          .at(-1)
        return {
          id: `turn-${task.id}-${group.id}`,
          label: (
            prompt?.text.trim() ||
            prompt?.attachments?.map((file) => file.name).join(', ') ||
            'Attached files'
          ).slice(0, 180),
          preview: response?.text.trim().slice(0, 320),
          status: group.status,
        }
      }),
    [task.id, groups],
  )
  return (
    <>
      {searchOpen && (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b px-3 py-1">
          <input
            type="search"
            autoFocus
            aria-label="Search this thread"
            placeholder="Search this thread…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setMatchIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setSearchOpen(false)
              }
              if (event.key === 'Enter' && matches.length)
                setMatchIndex(
                  (index) => (index + (event.shiftKey ? matches.length - 1 : 1)) % matches.length,
                )
            }}
            className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
          />
          <span role="status" className="text-xs tabular-nums text-muted-foreground">
            {matches.length ? Math.min(matchIndex + 1, matches.length) : 0}/{matches.length}
          </span>
          <IconButton
            label="Previous match"
            className="size-7"
            disabled={!matches.length}
            onClick={() => setMatchIndex((index) => (index + matches.length - 1) % matches.length)}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            label="Next match"
            className="size-7"
            disabled={!matches.length}
            onClick={() => setMatchIndex((index) => (index + 1) % matches.length)}
          >
            <ChevronDown size={14} />
          </IconButton>
          <IconButton
            label="Close thread search"
            className="size-7"
            onClick={() => setSearchOpen(false)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {searchOpen && selectedMatch && (
        <p
          className="shrink-0 truncate border-b px-3 py-1 text-xs text-muted-foreground"
          title={selectedMatch.preview}
        >
          {selectedMatch.role === 'user' ? 'You' : 'Agent'} · {selectedMatch.preview}
        </p>
      )}
      {linkError && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {linkError}
        </p>
      )}
      <ThreadLinkMenu
        key={linkScope}
        task={task}
        onSearch={() => {
          setSearchOpen(true)
          requestAnimationFrame(() => searchInput.current?.focus())
        }}
        onCopyThread={copyThread}
        canBookmark={(id) => connected && turns.get(id)?.status !== 'running'}
        onBookmark={async (messageId, bookmarked) => {
          await request(
            '/api/tasks/message/bookmark',
            { id: task.id, messageId, bookmarked },
            responses.ok,
          )
          history.setBookmark(messageId, bookmarked)
        }}
        onManagePulls={onManagePulls}
        onBrowser={onBrowser}
        onPullLink={(url) => onPullLink?.(url) || openPullLink?.(url) || false}
        onLinkPull={
          fullTask
            ? (url) => {
                selectPull(url)
              }
            : undefined
        }
        linked={(url) => {
          const pull = threadPullLink(url)
          return (
            !!pull &&
            (fullTask?.pullRequest?.url === pull.url ||
              !!fullTask?.linkedPullRequests?.some((item) => item.url === pull.url))
          )
        }}
      >
        <Conversation
          key={task.id}
          onClickCapture={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
            if (
              !(anchor instanceof HTMLAnchorElement) ||
              !/^https?:\/\//i.test(anchor.href) ||
              (!onPullLink && !openPullLink && (!chooseLink || !onBrowser))
            )
              return
            if (onPullLink?.(anchor.href) || openPullLink?.(anchor.href)) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            if (!chooseLink || !onBrowser) return
            event.preventDefault()
            event.stopPropagation()
            const url = anchor.href
            setLinkError('')
            void chooseLink(url)
              .then((internal) => {
                if (internal) onBrowser(url)
              })
              .catch((cause: unknown) =>
                setLinkError(cause instanceof Error ? cause.message : String(cause)),
              )
          }}
        >
          <ConversationHistory
            onReadingHistory={onReadingHistory}
            onLoadEarlier={
              history.hasMore && !history.busy && !history.error && connected
                ? () => void history.load()
                : undefined
            }
          >
            <ConversationContent className="mx-auto w-full max-w-[var(--chat-max)] gap-5 px-4 py-4 md:pl-16 md:pr-5">
              {history.busy && (
                <p role="status" className="text-xs text-muted-foreground">
                  Loading earlier messages…
                </p>
              )}
              {history.hasMore && !!history.error && (
                <Button
                  variant="ghost"
                  disabled={history.busy || !connected}
                  onClick={() => void history.load()}
                >
                  Retry loading earlier messages
                </Button>
              )}
              {search.error && (
                <p role="alert" className="text-xs text-destructive">
                  Could not search older history: {search.error}
                </p>
              )}
              {history.error && (
                <p role="alert" className="text-xs text-destructive">
                  {history.error}
                </p>
              )}
              {!!bookmarks.length && (
                <nav
                  aria-label="Bookmarked replies"
                  className="flex flex-wrap gap-1 rounded-md border p-2"
                >
                  {bookmarks.map((message, index) => (
                    <Button
                      key={message.id}
                      size="sm"
                      variant="ghost"
                      className="h-7 max-w-52 truncate text-xs"
                      onClick={() => {
                        const id = `message-${task.id}-${message.id}`
                        setBookmarkJump(id)
                        document
                          .getElementById(id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }}
                      title={message.text.slice(0, 180)}
                    >
                      <Star className="size-3 fill-current" /> {index + 1}.{' '}
                      {message.text.slice(0, 32)}
                    </Button>
                  ))}
                </nav>
              )}
              {!task.messages.length && !task.queue?.length && (
                <div className="py-8 text-center">
                  <h2 className="text-base font-medium">What would you like to work on?</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Describe a change or ask a question.
                  </p>
                </div>
              )}
              {groups.map((group, groupIndex) => (
                <section
                  key={group.id}
                  id={`turn-${task.id}-${group.id}`}
                  aria-label={`User request · ${conversationTurnLabel(group.status)}`}
                  className="flex min-w-0 flex-col gap-3"
                  style={
                    group.status === 'completed'
                      ? {
                          contentVisibility: 'auto',
                          containIntrinsicSize: 'auto 240px',
                        }
                      : undefined
                  }
                >
                  <DeferredTurn
                    immediate={
                      groupIndex >= groups.length - 2 ||
                      group.status === 'running' ||
                      group.messages.some(
                        (message) =>
                          message.id === selectedMatch?.id ||
                          `message-${task.id}-${message.id}` === revealMessage ||
                          `message-${task.id}-${message.id}` === bookmarkJump,
                      )
                    }
                  >
                    {() => {
                      const firstAssistant = group.messages.find(
                        (message) => message.role === 'assistant',
                      )
                      const finalAssistant = group.messages
                        .filter((message) => message.role === 'assistant')
                        .at(-1)
                      const render = (open: boolean, header?: ReactNode) =>
                        group.messages.map((message) => {
                          const turn = turns.get(message.id)
                          return (
                            <Fragment key={message.id}>
                              {message.id === firstAssistant?.id && header}
                              <ChatMessage
                                workOpen={open}
                                footer={
                                  message.id ===
                                  group.messages
                                    .filter((message) => message.role === 'assistant')
                                    .at(-1)?.id
                                }
                                final={
                                  group.status !== 'running' && message.id === finalAssistant?.id
                                }
                                taskId={task.id}
                                message={message}
                                turn={turn}
                                tools={activityGroups.byMessage.get(message.id) ?? emptyTools}
                                summaryTools={
                                  turn
                                    ? (activityGroups.byTurn.get(turn.id) ?? emptyTools)
                                    : emptyTools
                                }
                                compactions={
                                  compactionsByMessage.get(message.id) ?? emptyCompactions
                                }
                                highlighted={selectedMatch?.id === message.id}
                                pending={pending?.message.id === message.id ? pending : null}
                                taskRunning={task.status === 'running'}
                                latestTurnId={lastTurn?.id}
                                connected={connected}
                                request={request}
                                onTerminal={onTerminal}
                                onBookmark={history.setBookmark}
                              />
                            </Fragment>
                          )
                        })
                      return group.turn ? (
                        <TurnWork
                          turn={group.turn}
                          reveal={group.messages.some(
                            (message) =>
                              message.id === selectedMatch?.id ||
                              `message-${task.id}-${message.id}` === revealMessage ||
                              `message-${task.id}-${message.id}` === bookmarkJump,
                          )}
                        >
                          {render}
                        </TurnWork>
                      ) : (
                        render(true)
                      )
                    }}
                  </DeferredTurn>
                </section>
              ))}
              <TaskActivity
                tools={activityGroups.unassigned}
                status={
                  task.status === 'running'
                    ? 'running'
                    : task.status === 'failed'
                      ? 'failed'
                      : task.status === 'cancelled'
                        ? 'cancelled'
                        : 'completed'
                }
                error={activity.error}
              />
            </ConversationContent>
          </ConversationHistory>
          <ConversationRail items={markers} />
          <ConversationScrollButton />
        </Conversation>
      </ThreadLinkMenu>
      {pull && fullTask && (
        <PullLinkActions
          key={`${linkScope}:${pull.url}`}
          task={fullTask}
          pull={pull}
          onOpen={(url) => onPullLink?.(url) || openPullLink?.(url) || false}
          onClose={() => setSelectedPull(null)}
        />
      )}
    </>
  )
}
