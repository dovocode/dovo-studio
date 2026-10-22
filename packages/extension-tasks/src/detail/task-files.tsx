import { createRuntimeClient, taskFileShareSchema, markdownMediaKind } from '@dovo/protocol'
import { ProjectImagePreview } from './project-image-preview'
import { fileStats } from '../files/presentation'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import { getFiletypeFromFileName } from '@pierre/diffs'
import { preloadStudioHighlighter, useDiffOptions } from '@dovo/studio-ui/code-themes'
import { Editor } from '@pierre/diffs/edit'
import {
  EditProvider,
  File as PierreFile,
  type EditorFactory,
  type FileOptions,
} from '@pierre/diffs/react'
import { RefreshCw, Search, X } from 'lucide-react'
import { responses, useWorkspace, useStudioHost, type Task } from '@dovo/studio-core'
import { Button, IconButton, FileBrowserTree } from '@dovo/studio-ui'
import { ResizableSidebar } from './resizable-sidebar'
import { useLiveRefresh } from './live-refresh'
import { formatCodeReference } from './code-reference'
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)

function HighlightedFile({
  taskId,
  path,
  contents,
  onReference,
  onSave,
  onEditingChange,
  readOnly,
}: {
  readOnly: boolean
  taskId: string
  path: string
  contents: string
  onReference?: (text: string) => void
  onEditingChange?: (editing: boolean) => void
  onSave: (contents: string, expectedContents: string) => Promise<void>
}) {
  const [ready, setReady] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [selection, setSelection] = useApplicationState<{ start: number; end: number } | null>(null)
  const [editing, setEditing] = useApplicationState(false)
  const [dirty, setDirty] = useApplicationState(false)
  const [saving, setSaving] = useApplicationState(false)
  const [saveError, setSaveError] = useApplicationState('')
  const [pending, setPending] = useApplicationState<string | null>(null)
  const [editRevision, setEditRevision] = useApplicationState(0)
  useEffect(() => {
    onEditingChange?.(editing || pending !== null || saving)
    return () => onEditingChange?.(false)
  }, [editing, pending, saving, onEditingChange])
  const cancelEdit = useRef(false)
  const diffs = useDiffOptions()
  useEffect(() => {
    let active = true
    void preloadStudioHighlighter(getFiletypeFromFileName(path)).then(
      () => {
        if (active) setReady(true)
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [path])
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      ...diffs.options,
      disableFileHeader: true,
      enableLineSelection: !editing,
      enableGutterUtility: !editing,
      onLineSelectionEnd: (range) =>
        setSelection(
          range
            ? { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }
            : null,
        ),
      onGutterUtilityClick: (range) =>
        setSelection({
          start: Math.min(range.start, range.end),
          end: Math.max(range.start, range.end),
        }),
    }),
    [diffs.options, editing],
  )
  const file = useMemo(() => ({ name: path, contents }), [path, contents])
  const persist = async (next: string) => {
    setSaving(true)
    setSaveError('')
    try {
      await onSave(next, contents)
      setPending(null)
      setDirty(false)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b bg-background px-4 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">
          {path}
          {dirty ? ' •' : ''}
        </span>
        {selection && onReference && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[0.625rem]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onReference(formatCodeReference(path, selection.start, selection.end, contents))
              setSelection(null)
            }}
          >
            Add reference to composer
          </Button>
        )}
        {pending !== null ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              disabled={saving}
              onClick={() => {
                setPending(null)
                setSaveError('')
                setDirty(false)
                setEditRevision((value) => value + 1)
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[0.625rem]"
              disabled={saving}
              onClick={() => void persist(pending)}
            >
              {saving ? 'Saving…' : 'Retry save'}
            </Button>
          </>
        ) : editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() => {
                cancelEdit.current = true
                setEditing(false)
                setDirty(false)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() => setEditing(false)}
            >
              Save
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[0.625rem]"
            disabled={readOnly || !!selection || saving}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>
      {saveError && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
          {saveError}
        </p>
      )}
      <div className="studio-code min-h-0 flex-1 overflow-auto">
        {error ? (
          <p role="alert" className="p-4 text-xs text-destructive">
            {error}
          </p>
        ) : ready ? (
          <EditProvider createEditor={createEditor}>
            <PierreFile
              key={editRevision}
              file={file}
              options={options}
              edit={editing}
              editStateKey={`${taskId}:${path}`}
              onEditChange={() => setDirty(true)}
              onEditComplete={(event) => {
                if (cancelEdit.current) {
                  cancelEdit.current = false
                  return 'reject'
                }
                const next = event.file.contents
                if (next === contents) {
                  setDirty(false)
                  return 'reject'
                }
                setPending(next)
                void persist(next)
                return 'accept'
              }}
            />
          </EditProvider>
        ) : (
          <p className="p-4 text-xs text-muted-foreground">Loading file…</p>
        )}
      </div>
      <div className="border-t px-3 py-1 text-[0.625rem] text-muted-foreground">
        {editing
          ? `Editing file · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}Z undo · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}F find`
          : readOnly
            ? 'Read-only preview · Files over 1 MB must be edited externally'
            : 'Drag line numbers or Shift-click for a range · Click + for one line'}
      </div>
    </>
  )
}

export function TaskFiles({
  task,
  onReference,
  onEditingChange,
}: {
  task: Task
  onEditingChange?: (editing: boolean) => void
  onReference?: (text: string) => void
}) {
  const stats = useMemo(
    () => new Map(task.files.map((file) => [file.path, fileStats(file)])),
    [task.files],
  )
  const { request, connected, connection } = useWorkspace()
  const { openExternalLink } = useStudioHost()
  const [readError, setReadError] = useApplicationState('')
  const [loadedPath, setLoadedPath] = useApplicationState('')
  const [paths, setPaths] = useApplicationState<string[]>([])
  const [selected, setSelected] = useApplicationState('')
  const imageFile = markdownMediaKind(selected) === 'image'
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [contents, setContents] = useApplicationState('')
  const readOnly = useMemo(
    () => new TextEncoder().encode(contents).byteLength > 1024 * 1024,
    [contents],
  )
  const [loading, setLoading] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const editing = useRef(false)
  const editGeneration = useRef(0)
  const changedEditing = useCallback(
    (value: boolean) => {
      if (editing.current !== value) editGeneration.current += 1
      editing.current = value
      onEditingChange?.(value)
    },
    [onEditingChange],
  )
  const [query, setQuery] = useApplicationState('')
  const filter = useDeferredValue(query.trim().toLowerCase())
  useEffect(() => {
    setContents('')
    setReadError('')
    setLoadedPath('')
    setLoading(!!selected)
  }, [selected])
  const refresh = useCallback(async () => {
    try {
      const listing = await request(
        '/api/tasks/files/list',
        { id: task.id },
        responses.projectFileList,
      )
      setPaths((previous) =>
        previous.length === listing.files.length &&
        previous.every((path, index) => path === listing.files[index])
          ? previous
          : listing.files,
      )
      if (selected && imageFile && selectedRef.current === selected) {
        setLoadedPath(selected)
        setReadError('')
      } else if (selected && !editing.current) {
        const generation = editGeneration.current
        try {
          const result = await request(
            '/api/tasks/files/read',
            { id: task.id, path: selected },
            responses.projectFile,
          )
          if (
            selectedRef.current === selected &&
            !editing.current &&
            generation === editGeneration.current
          ) {
            setContents(result.contents)
            setLoadedPath(selected)
            setReadError('')
          }
        } catch (cause: unknown) {
          if (
            selectedRef.current === selected &&
            !editing.current &&
            generation === editGeneration.current
          )
            setReadError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    } finally {
      if (selectedRef.current === selected) setLoading(false)
    }
  }, [request, task.id, selected, revision, imageFile])
  const refreshError = useLiveRefresh(connected, refresh)
  const openOriginal = () => {
    const preview = openExternalLink ? null : window.open('about:blank', '_blank')
    if (preview) preview.opener = null
    void request('/api/tasks/files/share', { taskId: task.id, path: selected }, taskFileShareSchema)
      .then(async ({ url }) => {
        if (!connection) throw new Error('Reconnect to open this file.')
        const address = createRuntimeClient(connection).url(url)
        if (openExternalLink) await openExternalLink(address)
        else if (preview) preview.location.href = address
        else throw new Error('Allow popups to open this file.')
      })
      .catch((cause: unknown) => {
        preview?.close()
        if (selectedRef.current === selected)
          setReadError(cause instanceof Error ? cause.message : String(cause))
      })
  }
  const root = useMemo(
    () =>
      paths
        .filter((path) => path.toLowerCase().includes(filter))
        .map((path) => ({ ...stats.get(path), path })),
    [paths, filter, stats],
  )
  return (
    <section className="flex h-full min-w-0 flex-col bg-background" aria-label="Project files">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 text-xs font-medium">
        Files <span className="text-muted-foreground">{paths.length}</span>
        <IconButton
          label="Refresh files"
          className="ml-auto size-7"
          disabled={!connected || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </IconButton>
      </header>
      {refreshError && (!selected || loadedPath === selected) && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {refreshError}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              {readError || (refreshError && loadedPath !== selected) ? (
                <div role="alert" className="space-y-3 p-4 text-sm">
                  <p>{readError || refreshError}</p>
                  <div className="flex gap-2">
                    <Button
                      disabled={!connected || loading}
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      Retry file
                    </Button>
                    <Button variant="outline" disabled={!connected} onClick={openOriginal}>
                      Open in browser
                    </Button>
                  </div>
                </div>
              ) : loading ? (
                <p className="p-4 text-xs text-muted-foreground">Loading file…</p>
              ) : imageFile ? (
                <ProjectImagePreview
                  taskId={task.id}
                  path={selected}
                  onOpenOriginal={openOriginal}
                  refreshRevision={revision}
                />
              ) : (
                <HighlightedFile
                  key={selected}
                  onEditingChange={changedEditing}
                  taskId={task.id}
                  path={selected}
                  contents={contents}
                  readOnly={readOnly}
                  onReference={onReference}
                  onSave={async (next, expectedContents) => {
                    await request(
                      '/api/tasks/files/write',
                      { id: task.id, path: selected, contents: next, expectedContents },
                      responses.projectFile,
                    )
                    if (selectedRef.current === selected) setContents(next)
                  }}
                />
              )}
            </>
          ) : (
            <p className="p-4 text-xs text-muted-foreground">Choose a file to preview.</p>
          )}
        </div>
        <ResizableSidebar
          preference="projectFilesSidebarWidth"
          side="right"
          label="project file tree"
          maxFraction={0.4}
          maxWidth={640}
          aria-label="Project file tree"
          className="flex min-h-0 flex-col border-l bg-sidebar"
        >
          <div className="relative border-b p-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-5 size-3.5 text-muted-foreground"
            />
            <input
              type="search"
              aria-label="Search project files"
              placeholder="Search files…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-md border border-border/60 bg-background pl-8 pr-8 text-xs outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear file search"
                onClick={() => setQuery('')}
                className="absolute right-3 top-3 flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5">
            {filter && !root.length && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No matching files.</p>
            )}
            <FileBrowserTree
              files={root}
              selected={selected}
              onSelect={setSelected}
              search={filter}
            />
          </div>
        </ResizableSidebar>
      </div>
    </section>
  )
}
