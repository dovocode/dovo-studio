import { ToggleButton } from '@dovo/studio-ui/toggle-button'
import { useTaskSearch } from '../list/use-task-search'
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { watchRuntimeSettled } from '@dovo/protocol'
import { MessageSquare, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, Input, cn } from '@dovo/studio-ui'
import type { TaskEntry } from '../list/task-collection'
import { switcherThreadGroups } from '../list/task-search'
import { useSearchSubthreads } from '../list/use-search-subthreads'

export type TaskSearchMode = 'tasks' | 'messages'

/** ⌘P jumps to any task on any computer; ⌘⇧F searches every conversation and opens the
 * message. Arrow keys move and Enter opens. Tab follows normal dialog navigation. */
export function TaskSearchDialog({
  mode,
  entries,
  onModeChange,
  onClose,
  onSelect,
}: {
  mode: TaskSearchMode | null
  entries: readonly TaskEntry[]
  onModeChange: (mode: TaskSearchMode) => void
  onClose: () => void
  onSelect: (entry: TaskEntry, messageId?: string) => void
}) {
  const uiText = useInterfaceText()
  const { runtimeRegistry, connection } = useWorkspace()
  const openSearch = !!mode
  const connections = [
    ...new Map(
      [
        ...runtimeRegistry.profiles.map((profile) => profile.connection),
        ...(connection ? [connection] : []),
      ].map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  ]
  const connectionIdentity = JSON.stringify(connections)
  const searchConnections = useEffectEvent(() => connections)
  useEffect(() => {
    if (!openSearch) return
    const stops = searchConnections().map((entry) => watchRuntimeSettled(entry))
    return () => stops.forEach((stop) => stop())
  }, [openSearch, connectionIdentity])
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState('')
  const [showSubthreads, setShowSubthreads] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const lastMode = useRef<TaskSearchMode | null>(null)
  const saved = useRef<
    Partial<
      Record<
        TaskSearchMode,
        {
          query: string
          activeKey: string
          showSubthreads: boolean
          scrollTop: number
        }
      >
    >
  >({})
  const restoring = useRef(false)
  useLayoutEffect(() => {
    const previous = lastMode.current
    lastMode.current = mode
    if (!mode) {
      restoring.current = false
      setQuery('')
      setActiveKey('')
      setShowSubthreads(false)
      return
    }
    if (previous) {
      setActiveKey('')
      restoring.current = false
      return
    }
    const state = saved.current[mode]
    if (!state) return
    setQuery(state.query)
    setActiveKey(state.activeKey)
    setShowSubthreads(state.showSubthreads)
    restoring.current = true
  }, [mode])
  const search = useTaskSearch(entries, mode === 'messages' ? query : '')
  const altHeld = useSearchSubthreads(mode === 'tasks')
  const revealSubthreads = showSubthreads || altHeld
  const threadGroups = useMemo(
    () => (mode === 'tasks' ? switcherThreadGroups(entries, query) : []),
    [entries, query, mode],
  )
  const matchingSubthreads = threadGroups.some((group) => group.matches.length)
  const results = useMemo(
    () =>
      mode === 'messages'
        ? search.hits.map((hit) => ({
            key: `${hit.entry.key}:${hit.messageId}`,
            entry: hit.entry,
            messageId: hit.messageId,
            title: hit.entry.task.title,
            detail: `${hit.entry.projectName} · ${hit.entry.source.name}${hit.entry.task.archivedAt ? ' · Archived' : ''}`,
            snippet: hit.snippet,
            child: false,
          }))
        : threadGroups.flatMap(({ entry, matches }) => [
            {
              key: entry.key,
              entry,
              messageId: undefined,
              title: entry.task.title,
              child: false,
              detail: `${entry.projectName} · ${entry.source.name}${entry.task.archivedAt ? ' · Archived' : ''}${matches.length ? ` · ${matches.length} matching subthread${matches.length === 1 ? '' : 's'}` : ''}`,
              snippet: undefined,
            },
            ...(revealSubthreads
              ? matches.map((child) => ({
                  key: child.key,
                  entry: child,
                  messageId: undefined,
                  title: child.task.title,
                  child: true,
                  detail: `Subthread · ${child.projectName} · ${child.source.name}`,
                  snippet: undefined,
                }))
              : []),
          ]),
    [threadGroups, mode, search.hits, revealSubthreads],
  )
  const activeParent = threadGroups.find((group) =>
    group.matches.some((match) => match.key === activeKey),
  )?.entry.key
  const active = Math.max(
    0,
    results.findIndex(
      (result) => result.key === activeKey || (!revealSubthreads && result.key === activeParent),
    ),
  )

  const scrolledKey = useRef('')
  useLayoutEffect(() => {
    if (!mode || !list.current) {
      scrolledKey.current = ''
      return
    }
    if (restoring.current) {
      const state = saved.current[mode]
      if (!state || query !== state.query || activeKey !== state.activeKey || search.loading) return
      restoring.current = false
      list.current.scrollTop = state.scrollTop
    }
    const key = results[active]?.key ?? ''
    if (key === scrolledKey.current) return
    scrolledKey.current = key
    list.current.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, activeKey, results, mode, query, search.loading])
  const open = (index: number) => {
    const result = results[index]
    if (!result || !mode) return
    saved.current[mode] = {
      query,
      activeKey: result.key,
      showSubthreads: showSubthreads || result.child,
      scrollTop: list.current?.scrollTop ?? 0,
    }
    onSelect(result.entry, result.messageId)
    onClose()
  }
  return (
    <Dialog open={!!mode} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        className="top-[20%] max-w-xl translate-y-0 gap-2 p-2 [&_[data-dialog-close]]:-right-4 [&_[data-dialog-close]]:-top-4"
        onOpenAutoFocus={(event) => {
          const focused = document.activeElement
          opener.current = focused instanceof HTMLElement ? focused : null
          event.preventDefault()
          input.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return
          event.preventDefault()
          opener.current.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="sr-only">
          {mode === 'messages' ? 'Search conversations' : 'Go to thread'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Type to search, use the arrow keys to choose, and Enter to open.
        </DialogDescription>
        <div className="flex min-h-8 items-center gap-2 pl-2 pr-10 max-sm:min-h-11 max-sm:pr-12">
          {mode === 'messages' ? (
            <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <Search className="size-4 text-muted-foreground" aria-hidden />
          )}
          <Input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label={mode === 'messages' ? 'Search conversations' : 'Go to thread'}
            placeholder={mode === 'messages' ? 'Search all conversations…' : 'Go to thread…'}
            value={query}
            onChange={(event) => {
              restoring.current = false
              setActiveKey('')
              setQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!results.length) return
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActiveKey(results[(active + step + results.length) % results.length].key)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                open(active)
              }
            }}
            className="h-9 border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 px-2">
          <div role="group" aria-label="Search scope" className="flex gap-1">
            {(['tasks', 'messages'] as const).map((scope) => (
              <ToggleButton
                key={scope}
                variant="ghost"
                size="sm"
                pressed={mode === scope}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11',
                  mode === scope && 'bg-accent text-foreground',
                )}
                onPressedChange={() => onModeChange(scope)}
              >
                {scope === 'tasks' ? 'Threads' : 'Messages'}
              </ToggleButton>
            ))}
          </div>
          {matchingSubthreads && (
            <ToggleButton
              variant="ghost"
              size="sm"
              aria-controls={listId}
              pressed={showSubthreads}
              className={cn(
                'rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11',
                showSubthreads && 'bg-accent text-foreground',
              )}
              onPressedChange={() => setShowSubthreads((value) => !value)}
            >
              {uiText('Show matching subthreads')}
            </ToggleButton>
          )}
        </div>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-busy={search.loading}
          className="h-[min(18rem,40vh)] overflow-y-auto"
        >
          {results.map((result, index) => (
            <li
              key={result.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
            >
              <button
                type="button"
                onMouseEnter={() => setActiveKey(result.key)}
                onClick={() => open(index)}
                className={cn(
                  'flex w-full min-w-0 flex-col rounded-md px-3 py-2 text-left',
                  index === active && 'bg-accent/55',
                  result.child && 'ml-4 w-[calc(100%-1rem)] border-l border-border',
                )}
              >
                <span className="truncate text-sm">{result.title}</span>
                {result.snippet && <span className="line-clamp-2 text-xs">{result.snippet}</span>}
                <span className="line-clamp-2 text-xs text-muted-foreground">{result.detail}</span>
              </button>
            </li>
          ))}
          {!results.length && !search.loading && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {mode === 'messages' && !query.trim()
                ? 'Search all conversations.'
                : search.savedOnly
                  ? uiText('No matches in saved messages.')
                  : search.error || search.offline
                    ? 'No matches in available results.'
                    : 'No matches.'}
            </li>
          )}
        </ul>
        <p
          role={search.error ? 'alert' : 'status'}
          className={cn(
            'min-h-4 break-words px-3 text-xs [overflow-wrap:anywhere]',
            search.error ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {search.error ? (
            <>
              {search.error}
              {search.loading && <span role="status"> · Searching other computers…</span>}
            </>
          ) : search.loading ? (
            'Searching conversations…'
          ) : search.offline ? (
            uiText('Offline computers · Showing saved messages for {value0}', {
              value0: search.offlineComputers.join(', '),
            })
          ) : mode === 'messages' && !query.trim() ? (
            'Type to search conversation history.'
          ) : mode === 'messages' && search.hits.length === 50 ? (
            'Showing up to 50 matches. Refine your search for older messages.'
          ) : matchingSubthreads ? (
            'Hold Alt to show matching subthreads.'
          ) : (
            '\u00a0'
          )}
        </p>
      </DialogContent>
    </Dialog>
  )
}
