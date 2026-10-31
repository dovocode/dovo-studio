import { createRuntimeClient, taskFileShareSchema, markdownMediaKind } from '@dovo/protocol'
import { ProjectImagePreview } from './project-image-preview'
import { ProjectFileBrowser } from './project-file-browser'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
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
import { Button, IconButton } from '@dovo/studio-ui'
import { ResizableSidebar } from './resizable-sidebar'
import { useLiveRefresh } from './live-refresh'
import { formatCodeReference } from './code-reference'
import { fileDrafts as drafts, draftPressureMessage } from './file-drafts'
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)
let nextEditorOwner = 0

const setDraft = drafts.set.bind(drafts)

function HighlightedFile({
  draftKey,
  path,
  contents,
  onReference,
  onSave,
  onSavedElsewhere,
  onEditingChange,
  readOnly,
  focusedLine,
  focusRevision,
}: {
  focusedLine?: number
  focusRevision: number
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
  useSyncExternalStore(drafts.subscribe, drafts.snapshot, drafts.snapshot)
  const draft = drafts.get(draftKey)
  const canEdit = drafts.canBegin(draftKey, contents)
  const editorRelease = useRef<(() => void) | null>(null)
  const releaseEditor = useCallback(() => {
    const release = editorRelease.current
    editorRelease.current = null
    release?.()
  }, [])
  const startEditing = () => {
    if (editorRelease.current || !drafts.begin(draftKey, contents)) return
    // Record ownership before batching the state update. The component can
    // unmount in this same event without ever committing editing=true.
    editorRelease.current = () => drafts.end(draftKey)
    setEditing(true)
  }
  const stopEditing = () => {
    releaseEditor()
    setEditing(false)
  }
  useEffect(() => releaseEditor, [draftKey, releaseEditor])
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
  const revealedLine = useRef('')
  const revealFrame = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      if (revealFrame.current !== undefined) cancelAnimationFrame(revealFrame.current)
    },
    [],
  )
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      ...diffs.options,
      disableFileHeader: true,
      onPostRender: (node, _file, phase) => {
        if (revealFrame.current !== undefined) {
          cancelAnimationFrame(revealFrame.current)
          revealFrame.current = undefined
        }
        if (phase === 'unmount' || !focusedLine || editing) return
        const target = `${path}:${focusedLine}:${focusRevision}`
        if (revealedLine.current === target) return
        // Pierre applies controlled selection after rendering. Wait for layout, and
        // locate the source line directly rather than depending on selection timing.
        revealFrame.current = requestAnimationFrame(() => {
          revealFrame.current = undefined
          const line = (node.shadowRoot ?? node).querySelector(`[data-line="${focusedLine}"]`)
          if (!line?.isConnected) return
          revealedLine.current = target
          line.scrollIntoView({ block: 'center' })
        })
      },
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
    [diffs.options, editing, focusedLine, focusRevision, path],
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
              onClick={startEditing}
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
                stopEditing()
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
                stopEditing()
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
            disabled={readOnly || !!selection || !canEdit}
            onClick={startEditing}
          >
            Edit
          </Button>
        )}
      </div>
      {(drafts.pressure || (!editing && !canEdit)) && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
          {draftPressureMessage}
        </p>
      )}
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
              selectedLines={focusedLine ? { start: focusedLine, end: focusedLine } : undefined}
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
  reveal,
  onReference,
  onEditingChange,
}: {
  task: Task
  reveal?: { path: string; line: number; checkoutId?: string; requestId: string }
  onEditingChange?: (editing: boolean) => void
  onReference?: (text: string) => void
}) {
  const { request, connected, connection } = useWorkspace()
  const { openExternalLink } = useStudioHost()
  const [readError, setReadError] = useApplicationState('')
  const [focusedLine, setFocusedLine] = useApplicationState<number | undefined>(undefined)
  const [focusRevision, setFocusRevision] = useApplicationState(0)
  const [selected, setSelected] = useApplicationState('')
  const [checkoutId, setCheckoutId] = useApplicationState<string | undefined>(undefined)
  const [preview, setPreview] = useApplicationState<{
    size?: number
    complete: boolean
    startLine: number
    hasMore: boolean
  } | null>(null)
  const [fullRead, setFullRead] = useApplicationState(false)
  useEffect(() => {
    if (!reveal) return
    setCheckoutId(reveal.checkoutId)
    setSelected(reveal.path)
    setFocusedLine(reveal.line)
    setFocusRevision((value) => value + 1)
    setFullRead(false)
  }, [reveal?.requestId])
  const draftScope = JSON.stringify([
    connection?.runtimeId,
    connection?.address,
    connection?.token,
    task.id,
    checkoutId,
    task.repositoryId,
    task.execution,
    task.checkoutBranch,
    task.existingWorktreePath,
    task.delegation?.checkoutId,
  ])
  const draftKey = JSON.stringify([draftScope, selected])
  useSyncExternalStore(drafts.subscribe, drafts.snapshot, drafts.snapshot)
  const imageFile = markdownMediaKind(selected) === 'image'
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const sourceRef = useRef({ request, taskId: task.id, draftScope })
  sourceRef.current = { request, taskId: task.id, draftScope }
  const reads = useRef(0)
  useEffect(
    () => () => {
      reads.current++
    },
    [],
  )
  const [contents, setContents] = useApplicationState('')
  const linked = task.linkedCheckouts?.find((link) => link.id === checkoutId)
  const readOnly =
    !preview?.complete || (checkoutId !== undefined && linked?.access !== 'edit') || !!task.example
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
  useEffect(() => {
    setContents('')
    setPreview(null)
    setReadError('')
    setLoading(!!selected)
  }, [selected, draftScope])
  useEffect(() => {
    onEditingChange?.(false)
  }, [selected, draftScope, onEditingChange])
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
        {
          id: task.id,
          path: selected,
          checkoutId,
          preview: {
            startLine: fullRead ? 1 : (focusedLine ?? 1),
            maxBytes: fullRead ? 1024 * 1024 : 256 * 1024,
          },
        },
        responses.projectFile,
      )
      if (
        current() &&
        !(editing.current && editingPath.current === selected) &&
        generation === editGeneration.current
      ) {
        const complete =
          result.complete === true &&
          result.truncated === false &&
          result.startLine === 1 &&
          result.size !== undefined &&
          result.size <= 1024 * 1024
        setContents(
          result.complete === undefined ? result.contents.slice(0, 200000) : result.contents,
        )
        setPreview({
          size: result.size,
          complete,
          startLine: result.startLine ?? 1,
          hasMore: result.hasMore === true,
        })
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
  }, [
    request,
    task.id,
    selected,
    revision,
    imageFile,
    draftScope,
    checkoutId,
    focusedLine,
    focusRevision,
    fullRead,
  ])
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
  return (
    <section className="flex h-full min-w-0 flex-col bg-background" aria-label="Project files">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 text-xs font-medium">
        Files
        {checkoutId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCheckoutId(undefined)
              setSelected('')
              setFocusedLine(undefined)
              setFullRead(false)
            }}
          >
            Show primary checkout
          </Button>
        )}
        <IconButton
          label="Refresh files"
          className="ml-auto size-7"
          disabled={!connected || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </IconButton>
      </header>
      {drafts.entries().length > 0 && (
        <div
          className="flex max-h-48 shrink-0 flex-wrap gap-2 overflow-auto border-b px-3 py-2 text-xs"
          aria-label="Unsaved file drafts"
        >
          <span>Unsaved drafts stay in this window. Save or download before closing.</span>
          {drafts.entries().map(({ key, scope, path, draft }) => (
            <div key={key} className="flex w-full flex-wrap items-center gap-2">
              {scope === draftScope ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelected(path)
                    setFullRead(true)
                  }}
                >
                  Recover draft: {path}
                </Button>
              ) : (
                <span>Draft from another task or checkout: {path}</span>
              )}
              {draft.saving && <span>Saving…</span>}
              {draft.error && <span role="alert">{draft.error}</span>}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([draft.contents], { type: 'text/plain;charset=utf-8' }),
                  )
                  const link = document.createElement('a')
                  link.href = url
                  link.download = path.split('/').pop() || 'draft.txt'
                  link.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                }}
              >
                Download draft: {path}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={draft.saving || drafts.isEditing(key)}
                onClick={() => drafts.discard(key)}
              >
                Discard draft: {path}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              {readError && !drafts.get(draftKey) ? (
                <div role="alert" className="space-y-3 p-4 text-sm">
                  <p>{readError}</p>
                  <div className="flex gap-2">
                    <Button
                      disabled={!connected || loading}
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      Retry file
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!connected || !!checkoutId}
                      onClick={openOriginal}
                    >
                      Open in browser
                    </Button>
                  </div>
                </div>
              ) : loading && !drafts.get(draftKey) ? (
                <p className="p-4 text-xs text-muted-foreground">Loading file…</p>
              ) : imageFile ? (
                <ProjectImagePreview
                  taskId={task.id}
                  checkoutId={checkoutId}
                  path={selected}
                  onOpenOriginal={openOriginal}
                  refreshRevision={revision}
                />
              ) : (
                <>
                  {preview && !preview.complete && (
                    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Read-only preview starting at line {preview.startLine}.{' '}
                        {preview.size === undefined
                          ? 'Update the runtime for bounded file reads.'
                          : `${preview.size} bytes total.`}
                      </span>
                      {preview.size !== undefined && preview.size <= 1024 * 1024 && (
                        <Button size="sm" variant="outline" onClick={() => setFullRead(true)}>
                          Load complete file to edit
                        </Button>
                      )}
                      {preview.hasMore && contents.includes('\n') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFocusedLine(preview.startLine + (contents.match(/\n/g)?.length ?? 0))
                            setFocusRevision((value) => value + 1)
                            setFullRead(false)
                          }}
                        >
                          Next lines
                        </Button>
                      )}
                    </div>
                  )}
                  <HighlightedFile
                    key={draftKey}
                    draftKey={draftKey}
                    onEditingChange={changedEditing}
                    onSavedElsewhere={refreshAfterSave}
                    path={selected}
                    contents={contents}
                    focusedLine={
                      focusedLine && preview ? focusedLine - preview.startLine + 1 : undefined
                    }
                    focusRevision={focusRevision}
                    readOnly={readOnly}
                    onReference={preview?.startLine === 1 ? onReference : undefined}
                    onSave={async (next, expectedContents) => {
                      const source = { request, taskId: task.id, draftScope }
                      const readGeneration = reads.current
                      await source.request(
                        '/api/tasks/files/write',
                        {
                          id: source.taskId,
                          checkoutId,
                          path: selected,
                          contents: next,
                          expectedContents,
                        },
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
                </>
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
          <ProjectFileBrowser
            key={draftScope}
            taskId={task.id}
            checkoutId={checkoutId}
            revision={revision}
            selected={selected}
            changedFiles={checkoutId ? [] : task.files}
            onSelect={(path, line) => {
              setSelected(path)
              setFullRead(false)
              setFocusedLine(line)
              setFocusRevision((value) => value + 1)
            }}
          />
        </ResizableSidebar>
      </div>
    </section>
  )
}
