import { useApplicationState } from '@dovo/studio-core/state'
import {
  ArrowLeft,
  ChevronRight,
  Check,
  MoreHorizontal,
  Folder,
  Home,
  LoaderCircle,
  Monitor,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { directoryPageSchema, useWorkspace, type DirectoryPage } from '@dovo/studio-core'
import { Button, DropdownMenu, Input, cn } from '@dovo/studio-ui'
export function DirectoryPicker({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const { request, connected, snapshot } = useWorkspace()
  const [location, setLocation] = useApplicationState({
    path: initialPath,
    hidden: false,
    query: '',
    offset: 0,
    delay: 0,
  })
  const [draft, setDraft] = useApplicationState(initialPath || '~/')
  const [data, setData] = useApplicationState<DirectoryPage | null>(null)
  const [busy, setBusy] = useApplicationState(true)
  const [error, setError] = useApplicationState('')
  const [selected, setSelected] = useApplicationState(0)
  const list = useRef<HTMLDivElement>(null)
  const breadcrumbs = useRef<HTMLElement>(null)
  const pathInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const editingPath = useRef(false)
  const id = useId()
  useEffect(() => {
    list.current?.focus()
  }, [])
  useEffect(() => {
    if (breadcrumbs.current) breadcrumbs.current.scrollLeft = breadcrumbs.current.scrollWidth
  }, [data?.path])
  useEffect(() => {
    const version = ++generation.current
    let active = true
    setBusy(connected)
    setError('')
    if (!connected) return
    const timer = setTimeout(() => {
      const { delay: _delay, ...input } = location
      void request('/api/scm/directories/read', input, directoryPageSchema)
        .then((result) => {
          if (!active || version !== generation.current) return
          setData(result)
          if (!editingPath.current) setDraft(displayPath(result.path, result.home))
          setSelected(0)
          if (list.current) list.current.scrollTop = 0
        })
        .catch((error: unknown) => {
          if (active && version === generation.current)
            setError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (active && version === generation.current) setBusy(false)
        })
    }, location.delay)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [location, request, connected])
  const update = (change: Partial<typeof location>) => {
    // Invalidate immediately, including the debounce window before the next request starts.
    generation.current++
    setBusy(connected)
    setError('')
    setLocation((previous) => ({
      ...previous,
      delay: 0,
      ...change,
    }))
  }
  const navigate = (path: string) => {
    if (!connected) return
    editingPath.current = false
    setDraft(displayPath(path || '~/', data?.home))
    update({
      path,
      query: '',
      offset: 0,
    })
    list.current?.focus()
  }
  const choose = () => {
    if (data && !busy && !error && connected) onSelect(data.path)
  }
  const entries = error ? [] : (data?.entries ?? [])
  const ready = !!data && !busy && !error && connected
  return (
    <section
      aria-label="Runtime folder picker"
      aria-busy={busy}
      className="flex min-h-0 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          choose()
          return
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
          event.preventDefault()
          pathInput.current?.focus()
          pathInput.current?.select()
          return
        }
        if (event.target !== list.current) return
        if (event.key === 'Backspace' || event.key === 'ArrowLeft') {
          event.preventDefault()
          if (data?.parent) navigate(data.parent)
          return
        }
        if (!ready || !entries.length) return
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? entries.length - 1
                : (selected + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) %
                  entries.length
          setSelected(next)
          document.getElementById(`${id}-${next}`)?.scrollIntoView({
            block: 'nearest',
          })
        }
        if (event.key === 'Enter' || event.key === 'ArrowRight') {
          event.preventDefault()
          const entry = entries[selected]
          if (entry) navigate(entry.path)
        }
      }}
    >
      <header className="shrink-0 space-y-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold">Choose folder</span>
          <Monitor className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
          <p
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={snapshot?.runtimeHost}
          >
            {snapshot?.runtimeHost || 'Connected computer'}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Close folder picker"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Parent folder"
            title="Parent folder"
            disabled={!connected || !data?.parent}
            onClick={() => {
              if (data?.parent) navigate(data.parent)
            }}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Input
            ref={pathInput}
            aria-label="Folder path"
            className="h-9 min-w-0 flex-1 font-mono text-xs"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            disabled={!connected}
            placeholder="~/Code"
            onChange={(event) => {
              const path = event.target.value
              editingPath.current = true
              setDraft(path)
              update({
                path,
                query: '',
                offset: 0,
                delay: 250,
              })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                event.preventDefault()
                navigate(draft)
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                list.current?.focus()
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Home folder"
            title="Home folder"
            disabled={!connected}
            onClick={() => navigate('')}
          >
            <Home className="size-4" />
          </Button>
        </div>
        {data?.breadcrumbs && (
          <nav ref={breadcrumbs} aria-label="Folder location" className="overflow-x-auto">
            <ol className="flex min-w-max items-center gap-1 text-xs text-muted-foreground">
              {data.breadcrumbs.map((crumb, index) => (
                <li key={crumb.path} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" />}
                  <button
                    type="button"
                    title={crumb.path}
                    aria-current={crumb.path === data.path ? 'location' : undefined}
                    disabled={!connected}
                    onClick={() => navigate(crumb.path)}
                    className="max-w-40 truncate rounded px-1.5 py-1.5 hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-ring aria-[current=location]:text-foreground"
                  >
                    {crumb.path === data.home ? 'Home' : crumb.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </header>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Filter folders"
            placeholder="Filter folders…"
            value={location.query}
            disabled={!connected}
            className="h-9 pl-9 text-sm"
            onChange={(event) =>
              update({
                query: event.target.value,
                offset: 0,
                delay: 250,
              })
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                list.current?.focus()
              }
            }}
          />
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              aria-label="Folder options"
              disabled={!connected}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-48 rounded-lg border bg-popover p-1 shadow-xl"
            >
              <DropdownMenu.CheckboxItem
                checked={location.hidden}
                onCheckedChange={(hidden) =>
                  update({
                    hidden,
                    offset: 0,
                  })
                }
                className="relative cursor-default rounded py-2 pl-8 pr-3 text-xs outline-none data-[highlighted]:bg-accent"
              >
                <DropdownMenu.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5" />
                </DropdownMenu.ItemIndicator>
                Show hidden folders
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {!connected && (
        <p role="status" className="px-5 pb-3 text-sm text-muted-foreground">
          This computer is offline. Reconnect to browse its folders.
        </p>
      )}
      {error && (
        <div className="mx-4 mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={!connected}
            onClick={() => update({})}
          >
            Retry
          </Button>
        </div>
      )}
      <div
        className="flex items-center gap-2 px-5 pb-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {!connected ? (
          'Offline'
        ) : error ? (
          'Folder unavailable'
        ) : busy ? (
          <>
            <LoaderCircle className="size-3 animate-spin" />
            Loading folders…
          </>
        ) : (
          <>
            {data?.total ?? entries.length}{' '}
            {(data?.total ?? entries.length) === 1 ? 'folder' : 'folders'}
            {location.query ? ' matching' : ''}
          </>
        )}
      </div>
      <div
        ref={list}
        id={id}
        role="listbox"
        aria-label="Directories"
        aria-activedescendant={ready && entries[selected] ? `${id}-${selected}` : undefined}
        tabIndex={0}
        className="h-[min(48dvh,24rem)] min-h-24 flex-1 overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        {!busy && !error && connected && !entries.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Folder className="size-7 opacity-50" />
            <p>{location.query ? 'No matching folders.' : 'This folder has no subfolders.'}</p>
            {!location.query && <p className="text-xs">You can still choose this folder.</p>}
          </div>
        )}
        {entries.map((entry, index) => (
          <button
            key={entry.path}
            id={`${id}-${index}`}
            type="button"
            role="option"
            aria-selected={index === selected}
            tabIndex={-1}
            disabled={!ready}
            title={entry.name}
            onMouseMove={() => setSelected(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => navigate(entry.path)}
            className={cn(
              'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm disabled:opacity-40',
              selected === index && 'bg-muted',
              'hover:bg-muted',
            )}
          >
            <Folder className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          </button>
        ))}
      </div>
      {data && !error && (location.offset > 0 || data.nextOffset !== null) && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready || !location.offset}
            onClick={() =>
              update({
                offset: Math.max(0, location.offset - 100),
              })
            }
          >
            Previous
          </Button>
          <span>
            {entries.length ? `${location.offset + 1}–${location.offset + entries.length}` : '0'}
            {data.total !== undefined ? ` of ${data.total}` : ''}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready || data.nextOffset === null}
            onClick={() => {
              if (data.nextOffset !== null)
                update({
                  offset: data.nextOffset,
                })
            }}
          >
            Next
          </Button>
        </div>
      )}
      <footer className="shrink-0 space-y-2 border-t bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Current folder</p>
            <p title={ready ? data.path : undefined} className="mt-1 truncate text-sm font-medium">
              {ready
                ? displayPath(data.path, data.home)
                : busy
                  ? 'Opening folder…'
                  : 'Choose an available folder'}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!ready}
            onClick={choose}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="shrink-0"
          >
            Choose this folder
          </Button>
        </div>
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          ↑ ↓ Navigate · Enter Open · Backspace Up · ⌘/Ctrl Enter Choose folder · Esc Close
        </p>
      </footer>
    </section>
  )
}
function displayPath(path: string, home?: string) {
  if (!home) return path
  if (path === home) return '~/'
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}
