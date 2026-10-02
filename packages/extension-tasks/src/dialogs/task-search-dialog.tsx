import { useTaskSearch } from '../list/use-task-search'
import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, Input, cn } from '@dovo/studio-ui'
import type { TaskEntry } from '../list/task-collection'
import { switcherResults } from '../list/task-search'

export type TaskSearchMode = 'tasks' | 'messages'

/** ⌘P jumps to any task on any computer; ⌘⇧F searches every conversation and opens the
 * message. Arrow keys move, Enter opens, Tab switches between the two. */
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
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [query, mode])
  useEffect(() => {
    if (!mode) setQuery('')
  }, [mode])
  const search = useTaskSearch(entries, mode === 'messages' ? query : '')
  const results = useMemo(
    () =>
      mode === 'messages'
        ? search.hits.map((hit) => ({
            key: `${hit.entry.key}:${hit.messageId}`,
            entry: hit.entry,
            messageId: hit.messageId,
            title: hit.entry.task.title,
            detail: hit.snippet,
          }))
        : switcherResults(entries, query).map((entry) => ({
            key: entry.key,
            entry,
            messageId: undefined,
            title: entry.task.title,
            detail: `${entry.projectName} · ${entry.source.name}${entry.task.archivedAt ? ' · Archived' : ''}`,
          })),
    [entries, query, mode, search.hits],
  )
  const open = (index: number) => {
    const result = results[index]
    if (!result) return
    onSelect(result.entry, result.messageId)
    onClose()
  }
  return (
    <Dialog open={!!mode} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-2 p-2">
        <DialogTitle className="sr-only">
          {mode === 'messages' ? 'Search conversations' : 'Go to task'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Type to search, use the arrow keys to choose, and Enter to open. Tab switches between
          tasks and messages.
        </DialogDescription>
        {(search.error || search.loading) && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            {search.error || 'Searching conversations…'}
          </p>
        )}
        <div className="flex items-center gap-2 px-2">
          {mode === 'messages' ? (
            <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <Search className="size-4 text-muted-foreground" aria-hidden />
          )}
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="task-search-results"
            aria-label={mode === 'messages' ? 'Search conversations' : 'Go to task'}
            placeholder={mode === 'messages' ? 'Search all conversations…' : 'Go to task…'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!results.length) return
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((index) => (index + step + results.length) % results.length)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                open(active)
              } else if (event.key === 'Tab') {
                event.preventDefault()
                onModeChange(mode === 'messages' ? 'tasks' : 'messages')
              }
            }}
            className="h-9 border-0 shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 text-[0.625rem] text-muted-foreground">
            Tab: {mode === 'messages' ? 'tasks' : 'messages'}
          </span>
        </div>
        <ul id="task-search-results" role="listbox" className="max-h-[50vh] overflow-y-auto">
          {results.map((result, index) => (
            <li key={result.key} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => open(index)}
                className={cn(
                  'flex w-full min-w-0 flex-col rounded-md px-3 py-2 text-left',
                  index === active && 'bg-accent/55',
                )}
              >
                <span className="truncate text-sm">{result.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{result.detail}</span>
              </button>
            </li>
          ))}
          {!results.length && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {mode === 'messages' && query.trim().length < 2
                ? 'Type at least two characters.'
                : 'No matches.'}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
