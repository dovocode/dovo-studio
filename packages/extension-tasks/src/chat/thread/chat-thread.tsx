import { reducedMotion } from '@dovo/studio-core'
import { useConversationHistory } from './use-conversation-history'
import { ChatMessage } from './chat-message'
import { TaskEmptyState } from '../../task-creation/task-empty-state'
import type { LinkTarget } from '@dovo/studio-core/links'
import { DeferredTurn } from './deferred-turn'
import { TurnWindow, TurnWindowContext } from './turn-window'
import {
  threadPullLink,
  unassignedConversationTools,
  conversationMessageTurns,
  conversationToolsByMessage,
  type PendingMessage,
  conversationPageSchema,
  taskTranscript,
  readConversationHistory,
  runtimeRequest,
  responses,
} from '@dovo/protocol'
import { TurnWork } from './turn-work'
import { PullLinkActions } from './pull-link-actions'
import { ThreadLinkMenu } from './thread-link-menu'
import { conversationTurns, conversationTurnLabel } from './conversation-turns'
import { useThreadSearch } from './use-thread-search'
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
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
import { useCommittedCallback } from '../../detail/use-committed-callback'
const emptyTools: ReturnType<typeof useTaskActivity>['tools'] = []
const emptyCompactions: NonNullable<Task['compactions']> = []
export function ChatThread({
  task: liveTask,
  onUseTemplate,
  onTerminal,
  pending,
  onBrowser,
  onPullLink,
  revealMessage,
  onRevealHandled,
  onManagePulls,
  onReadingHistory,
  active = true,
}: {
  task: Pick<Task, 'id' | 'messages' | 'turns' | 'status' | 'queue' | 'compactions'> & {
    archived?: Task['archived']
    autoProjectFallback?: Task['autoProjectFallback']
    historyBefore: Task['historyBefore']
    historyRevision: Task['historyRevision']
  }
  onUseTemplate?: (prompt: string) => void
  /** Shows the terminal after a chat command ran in it. */
  onTerminal?: (terminalId: string) => void
  pending?: readonly PendingMessage[] | null
  onBrowser?: (url: string) => void
  onPullLink?: (url: string) => boolean
  revealMessage?: string
  onRevealHandled?: () => void
  onManagePulls?: () => void
  onReadingHistory?: () => void
  active?: boolean
}) {
  const { request, connected, workspace, connection, activeRuntimeId } = useWorkspace()
  const linkScope = JSON.stringify([connection?.address, connection?.token, liveTask.id])
  const [recentScope, setRecentScope] = useState('')
  const onRecentReady = useCallback(() => setRecentScope(linkScope), [linkScope])
  const history = useConversationHistory(liveTask, recentScope === linkScope)
  const task = history.task
  const turnWindow = useMemo(() => new TurnWindow(), [linkScope])
  const { openLink, openPullLink } = useStudioHost()
  const openLinkDetails = (target: LinkTarget) =>
    target.kind === 'pull' &&
    target.runtimeId === activeRuntimeId &&
    (onPullLink?.(target.navigationUrl) ?? false)
  const [linkError, setLinkError] = useState('')
  const [selectedPull, setSelectedPull] = useState<{ scope: string; url: string } | null>(null)
  const pull = selectedPull?.scope === linkScope ? threadPullLink(selectedPull.url) : null
  const fullTask = workspace.tasks.find((item) => item.id === liveTask.id)
  const linkOperation = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    const controller = new AbortController()
    linkOperation.current = controller
    return () => controller.abort()
  }, [active, linkScope])
  const copyOperation = useRef<AbortController | null>(null)
  const [copying, setCopying] = useState(false)
  useLayoutEffect(() => {
    if (!active) copyOperation.current?.abort()
    return () => copyOperation.current?.abort()
  }, [active, linkScope, task.historyRevision])
  const copyThread = async () => {
    if (!active || copyOperation.current) return
    const operation = new AbortController()
    copyOperation.current = operation
    setCopying(true)
    try {
      const transcript = await readConversationHistory(
        task,
        (before, signal) => {
          if (!connection || !connected) throw new Error('Reconnect to copy the full conversation.')
          return runtimeRequest(
            connection,
            connection.address,
            '/api/tasks/history',
            { id: task.id, before },
            conversationPageSchema,
            'POST',
            undefined,
            signal,
          )
        },
        operation.signal,
      )
      if (!operation.signal.aborted)
        await navigator.clipboard.writeText(
          taskTranscript({ ...transcript, title: fullTask?.title ?? 'Thread' }),
        )
    } catch (cause) {
      if (!operation.signal.aborted) throw cause
    } finally {
      if (copyOperation.current === operation) {
        copyOperation.current = null
        setCopying(false)
      }
    }
  }
  const loadEarlier = useCommittedCallback(() => void history.load())
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
        ?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center' }),
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
    const byMessage = conversationToolsByMessage(task, activity.tools)
    const byTurn = new Map<string, typeof emptyTools>()
    for (const tool of activity.tools) {
      if (!tool.turnId) continue
      const tools = byTurn.get(tool.turnId) ?? []
      tools.push(tool)
      byTurn.set(tool.turnId, tools)
    }
    const unassigned = unassignedConversationTools(task, activity.tools, byMessage)
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
  const retention = useRef({ groups, seeking: false, trim: history.trim })
  useEffect(() => {
    retention.current = { groups, seeking: !!target && !targetVisible, trim: history.trim }
  })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = turnWindow.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const root = turnWindow.scrollRoot
        const { groups, seeking, trim } = retention.current
        // Only at the live end can distant earlier pages leave without moving the reader.
        if (seeking || !root || root.scrollHeight - root.clientHeight - root.scrollTop > 16) return
        trim(groups.find((group) => turnWindow.mounted.has(group.id))?.messages[0]?.id)
      }, 1000)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [turnWindow])
  const emptyDraft =
    task.status === 'draft' &&
    !task.messages.length &&
    !task.queue?.length &&
    !task.turns?.length &&
    !task.historyBefore &&
    !task.compactions?.length &&
    !activity.tools.length &&
    !activity.error &&
    !history.error &&
    !search.error
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
    <TurnWindowContext value={turnWindow}>
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
        task={{ ...task, repositoryId: fullTask?.repositoryId }}
        onSearch={() => {
          setSearchOpen(true)
          requestAnimationFrame(() => searchInput.current?.focus())
        }}
        onCopyThread={copyThread}
        copying={copying}
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
        onDetails={openLinkDetails}
        runtimeId={activeRuntimeId ?? undefined}
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
          key={linkScope}
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
            if (!(anchor instanceof HTMLAnchorElement) || !/^https?:\/\//i.test(anchor.href)) return
            if (!openLink) return
            event.preventDefault()
            event.stopPropagation()
            const url = anchor.href
            setLinkError('')
            try {
              openLink(url, {
                origin: {
                  runtimeId: activeRuntimeId ?? undefined,
                  repositoryId: fullTask?.repositoryId,
                },
                details: openLinkDetails,
                browser: onBrowser,
                signal: linkOperation.current?.signal,
              })
            } catch (cause) {
              setLinkError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
        >
          <ConversationHistory
            active={active}
            settled={liveTask.archived}
            onReady={onRecentReady}
            onReadingHistory={onReadingHistory}
            onLoadEarlier={
              history.hasMore && !history.busy && !history.error && connected
                ? loadEarlier
                : undefined
            }
          >
            <ConversationContent
              className={
                emptyDraft
                  ? 'mx-auto h-full w-full max-w-[var(--chat-max)] gap-0 p-0'
                  : 'mx-auto w-full max-w-[var(--chat-max)] gap-5 px-4 py-4 md:pl-16 md:pr-5'
              }
            >
              {liveTask.autoProjectFallback && (
                <p role="note" className="text-xs text-muted-foreground">
                  Scope found no matching project; continued in General.
                </p>
              )}
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
                        document.getElementById(id)?.scrollIntoView({
                          behavior: reducedMotion() ? 'instant' : 'smooth',
                          block: 'center',
                        })
                      }}
                      title={message.text.slice(0, 180)}
                    >
                      <Star className="size-3 fill-current" /> {index + 1}.{' '}
                      {message.text.slice(0, 32)}
                    </Button>
                  ))}
                </nav>
              )}
              {emptyDraft && <TaskEmptyState />}
              <div className="flex flex-col gap-5">
                {groups.map((group, groupIndex) => (
                  <section
                    key={group.id}
                    id={`turn-${task.id}-${group.id}`}
                    aria-label={`User request · ${conversationTurnLabel(group.status)}`}
                    className="studio-chat-turn flex min-w-0 flex-col gap-3"
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
                      id={group.id}
                      pinned={
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
                        const render = (open: boolean, header?: ReactNode) => (
                          <div className="flex flex-col gap-3">
                            {group.messages.map((message) => {
                              const turn = turns.get(message.id)
                              return (
                                <Fragment key={message.id}>
                                  {message.id === firstAssistant?.id && header}
                                  <ChatMessage
                                    onUseTemplate={onUseTemplate}
                                    workOpen={open}
                                    footer={message.id === finalAssistant?.id}
                                    final={
                                      group.status !== 'running' &&
                                      message.id === finalAssistant?.id
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
                                    pending={
                                      pending?.find((item) => item.message.id === message.id) ??
                                      null
                                    }
                                    taskRunning={task.status === 'running'}
                                    latestTurnId={lastTurn?.id}
                                    connected={connected}
                                    request={request}
                                    onTerminal={onTerminal}
                                    onBookmark={history.setBookmark}
                                  />
                                </Fragment>
                              )
                            })}
                          </div>
                        )
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
              </div>
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
    </TurnWindowContext>
  )
}
