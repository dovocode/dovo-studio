import { createRuntimeClient, taskFileShareSchema, markdownMediaKind } from '@dovo/protocol'
import { ProjectImagePreview } from './project-image-preview'
import { fileStats } from '../files/presentation'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useDeferredValue,
  useSyncExternalStore,
} from 'react'
import { getFiletypeFromFileName } from '@pierre/diffs'
import { preloadStudioHighlighter, useDiffOptions } from '@dovo/studio-ui/code-themes'
import { Editor } from '@pierre/diffs/edit'
import {
  EditProvider,
  File as PierreFile,
  type EditorFactory,
  type FileOptions,
} from '@pierre/diffs/react'
import { RefreshCw } from 'lucide-react'
import { responses, useWorkspace, useStudioHost, type Task } from '@dovo/studio-core'
import { Button, IconButton, FileBrowserTree, SearchField } from '@dovo/studio-ui'
import { ResizableSidebar } from './resizable-sidebar'
import { useLiveRefresh } from './live-refresh'
import { formatCodeReference } from './code-reference'
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)
let nextEditorOwner = 0

type FileDraft = { contents: string; expectedContents: string; saving: boolean; error: string }
const drafts = new Map<string, FileDraft>()
const draftListeners = new Set<() => void>()
function setDraft(key: string, draft: FileDraft | null) {
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  for (const listener of draftListeners) listener()
}
function subscribeDrafts(listener: () => void) {
  draftListeners.add(listener)
  return () => {
    draftListeners.delete(listener)
  }
}

function HighlightedFile({
  draftKey,
  path,
  contents,
  onReference,
  onSave,
  onSavedElsewhere,
  onEditingChange,
  readOnly,
}: {
  readOnly: boolean
  draftKey: string
  path: string
  contents: string
  onReference?: (text: string) => void
  onEditingChange?: (path: string, editing: boolean) => void
  onSave: (contents: string, expectedContents: string) => Promise<void>
  onSavedElsewhere: () => void
}) {
  const [ready, setReady] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [selection, setSelection] = useApplicationState<{ start: number; end: number } | null>(null)
  const [editing, setEditing] = useApplicationState(false)
  const draft = useSyncExternalStore(
    subscribeDrafts,
    () => drafts.get(draftKey),
    () => undefined,
  )
  const [editRevision, setEditRevision] = useApplicationState(0)
  const [editorOwner] = useApplicationState(() => ++nextEditorOwner)
  const wasSaving = useRef(false)
  useEffect(() => {
    if (wasSaving.current && !draft) onSavedElsewhere()
    wasSaving.current = !!draft?.saving
  }, [draft, onSavedElsewhere])
  useEffect(() => {
    onEditingChange?.(path, editing)
    return () => onEditingChange?.(path, false)
  }, [editing, onEditingChange, path])
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
  const displayedContents = draft?.contents ?? contents
  const file = useRef({ name: path, contents: displayedContents })
  if (!editing && (file.current.name !== path || file.current.contents !== displayedContents))
    file.current = { name: path, contents: displayedContents }
  const persist = async () => {
    const current = drafts.get(draftKey)
    if (!current || current.saving) return
    const saving = { ...current, saving: true, error: '' }
    setDraft(draftKey, saving)
    try {
      await onSave(saving.contents, saving.expectedContents)
      if (drafts.get(draftKey) === saving) setDraft(draftKey, null)
    } catch (cause) {
      if (drafts.get(draftKey) === saving)
        setDraft(draftKey, {
          ...saving,
          saving: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })
    }
  }
  return (
    <>
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b bg-background px-4 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">
          {path}
          {draft ? ' •' : ''}
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
        {!editing && draft ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              disabled={draft.saving}
              onClick={() => {
                setDraft(draftKey, null)
                setEditRevision((value) => value + 1)
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[0.625rem]"
              disabled={draft.saving}
              onClick={() => void persist()}
            >
              {draft.saving ? 'Saving…' : draft.error ? 'Retry save' : 'Save draft'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[0.625rem]"
              disabled={draft.saving || readOnly}
              onClick={() => setEditing(true)}
            >
              Resume editing
            </Button>
          </>
        ) : editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() => {
                setDraft(draftKey, null)
                setEditing(false)
                setEditRevision((value) => value + 1)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() => {
                setEditing(false)
                void persist()
                setEditRevision((value) => value + 1)
              }}
            >
              Save
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[0.625rem]"
            disabled={readOnly || !!selection}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>
      {draft?.error && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
          {draft.error}
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
              file={file.current}
              options={options}
              edit={editing}
              editStateKey={`project-file:${editorOwner}:${editRevision}`}
              onEditChange={(event) => {
                const current = drafts.get(draftKey)
                const expectedContents = current?.expectedContents ?? contents
                setDraft(
                  draftKey,
                  event.file.contents === expectedContents
                    ? null
                    : {
                        contents: event.file.contents,
                        expectedContents,
                        saving: false,
                        error: '',
                      },
                )
              }}
              onEditComplete={() => 'reject'}
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
  const [paths, setPaths] = useApplicationState<string[]>([])
  const [truncated, setTruncated] = useApplicationState<boolean | null | undefined>(undefined)
  const [selected, setSelected] = useApplicationState('')
  const draftScope = JSON.stringify([
    connection?.runtimeId,
    connection?.address,
    connection?.token,
    task.id,
    task.repositoryId,
    task.execution,
    task.checkoutBranch,
    task.existingWorktreePath,
    task.delegation?.checkoutId,
  ])
  const draftKey = JSON.stringify([draftScope, selected])
  const imageFile = markdownMediaKind(selected) === 'image'
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const sourceRef = useRef({ request, taskId: task.id, draftScope })
  sourceRef.current = { request, taskId: task.id, draftScope }
  const reads = useRef(0)
  const listings = useRef(0)
  useEffect(
    () => () => {
      reads.current++
      listings.current++
    },
    [],
  )
  const [contents, setContents] = useApplicationState('')
  const readOnly = useMemo(
    () => new TextEncoder().encode(contents).byteLength > 1024 * 1024,
    [contents],
  )
  const [loading, setLoading] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const editing = useRef(false)
  const editingPath = useRef('')
  const editingScope = useRef('')
  const editGeneration = useRef(0)
  if (
    editingPath.current &&
    (editingPath.current !== selected || editingScope.current !== draftScope)
  ) {
    editing.current = false
    editingPath.current = ''
    editGeneration.current += 1
  }
  const changedEditing = useCallback(
    (path: string, value: boolean) => {
      if (value && path !== selectedRef.current) return
      if (!value && path !== editingPath.current) return
      if (
        path === selectedRef.current &&
        (editing.current !== value || (value && editingPath.current !== path))
      )
        editGeneration.current += 1
      editing.current = value
      editingPath.current = value ? path : ''
      editingScope.current = value ? draftScope : ''
      onEditingChange?.(value)
    },
    [onEditingChange, draftScope],
  )
  const refreshAfterSave = useCallback(() => setRevision((value) => value + 1), [])
  const [query, setQuery] = useApplicationState('')
  const filter = useDeferredValue(query.trim().toLowerCase())
  useEffect(() => {
    setContents('')
    setReadError('')
    setLoading(!!selected)
  }, [selected, draftScope])
  useEffect(() => {
    onEditingChange?.(false)
  }, [selected, draftScope, onEditingChange])
  const refreshListing = useCallback(async () => {
    const attempt = ++listings.current
    const listing = await request(
      '/api/tasks/files/list',
      { id: task.id },
      responses.projectFileList,
    )
    if (
      attempt !== listings.current ||
      sourceRef.current.request !== request ||
      sourceRef.current.taskId !== task.id
    )
      return
    setPaths((previous) =>
      previous.length === listing.files.length &&
      previous.every((path, index) => path === listing.files[index])
        ? previous
        : listing.files,
    )
    setTruncated(listing.truncated ?? null)
  }, [request, task.id, revision])
  const refresh = useCallback(async () => {
    const attempt = ++reads.current
    if (!selected || (editing.current && editingPath.current === selected)) return
    const generation = editGeneration.current
    const current = () =>
      attempt === reads.current &&
      selectedRef.current === selected &&
      sourceRef.current.request === request &&
      sourceRef.current.taskId === task.id &&
      sourceRef.current.draftScope === draftScope
    try {
      if (imageFile) {
        setReadError('')
        return
      }
      const result = await request(
        '/api/tasks/files/read',
        { id: task.id, path: selected },
        responses.projectFile,
      )
      if (
        current() &&
        !(editing.current && editingPath.current === selected) &&
        generation === editGeneration.current
      ) {
        setContents(result.contents)
        setReadError('')
      }
    } catch (cause: unknown) {
      if (
        current() &&
        !(editing.current && editingPath.current === selected) &&
        generation === editGeneration.current
      )
        setReadError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (current()) setLoading(false)
    }
  }, [request, task.id, selected, revision, imageFile, draftScope])
  const listingError = useLiveRefresh(connected, refreshListing)
  useLiveRefresh(connected, refresh)
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
      {listingError && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {listingError}
        </p>
      )}
      {!listingError && truncated !== undefined && truncated !== false && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {truncated
            ? 'Some files are omitted. Folder listings skip directories at 50 levels; listings are limited to 200,000 files.'
            : 'Listing completeness is unknown. Search covers the loaded files.'}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              {readError ? (
                <div role="alert" className="space-y-3 p-4 text-sm">
                  <p>{readError}</p>
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
                  key={draftKey}
                  draftKey={draftKey}
                  onEditingChange={changedEditing}
                  onSavedElsewhere={refreshAfterSave}
                  path={selected}
                  contents={contents}
                  readOnly={readOnly}
                  onReference={onReference}
                  onSave={async (next, expectedContents) => {
                    const source = { request, taskId: task.id, draftScope }
                    const readGeneration = reads.current
                    await source.request(
                      '/api/tasks/files/write',
                      { id: source.taskId, path: selected, contents: next, expectedContents },
                      responses.projectFile,
                    )
                    if (
                      selectedRef.current === selected &&
                      sourceRef.current.draftScope === source.draftScope &&
                      sourceRef.current.taskId === source.taskId &&
                      sourceRef.current.request === source.request &&
                      reads.current === readGeneration
                    )
                      setContents(next)
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
          <div className="border-b p-2">
            <SearchField
              role="searchbox"
              aria-label="Search project files"
              placeholder="Search files…"
              value={query}
              onValueChange={setQuery}
              clearLabel="Clear file search"
              className="text-xs"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5">
            {filter && !root.length && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {truncated === false ? 'No matching files.' : 'No matching files in this listing.'}
              </p>
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
