import { fileStats, FileIcon, DiffAmounts } from '../files/presentation'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo, useRef } from 'react'
import { getFiletypeFromFileName, preloadHighlighter } from '@pierre/diffs'
import { Editor } from '@pierre/diffs/edit'
import {
  EditProvider,
  File as PierreFile,
  type EditorFactory,
  type FileOptions,
} from '@pierre/diffs/react'
import { ChevronDown, Folder, RefreshCw } from 'lucide-react'
import { responses, useDiffOptions, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, IconButton, cn } from '@dovo/studio-ui'
import { formatCodeReference } from './code-reference'
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)

function HighlightedFile({
  taskId,
  path,
  contents,
  onReference,
  onSave,
}: {
  taskId: string
  path: string
  contents: string
  onReference?: (text: string) => void
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
  const cancelEdit = useRef(false)
  const diffs = useDiffOptions()
  useEffect(() => {
    let active = true
    void preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(path)],
    }).then(
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
            disabled={!!selection || saving}
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
          ? 'Editing file · ⌘Z undo · ⌘F find'
          : 'Drag line numbers or Shift-click for a range · Click + for one line'}
      </div>
    </>
  )
}

type Directory = { folders: Map<string, Directory>; files: string[] }
function tree(paths: string[]) {
  const root: Directory = { folders: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part)
      if (!child) {
        child = { folders: new Map(), files: [] }
        node.folders.set(part, child)
      }
      node = child
    }
    node.files.push(path)
  }
  return root
}
function DirectoryRows({
  node,
  selected,
  select,
  stats,
}: {
  stats: Map<string, ReturnType<typeof fileStats>>
  node: Directory
  selected: string
  select: (path: string) => void
}) {
  return (
    <>
      {[...node.folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details key={name} className="group/folder" open>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50">
              <ChevronDown className="size-3 shrink-0 -rotate-90 transition-transform group-open/folder:rotate-0" />
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </summary>
            <div className="ml-3 border-l border-border/60 pl-1">
              <DirectoryRows node={child} selected={selected} select={select} stats={stats} />
            </div>
          </details>
        ))}
      {node.files
        .sort((a, b) => a.localeCompare(b))
        .map((path) => (
          <Button
            key={path}
            variant="ghost"
            title={path}
            onClick={() => select(path)}
            className={cn(
              'h-7 w-full justify-start gap-2 rounded px-2 text-xs font-normal',
              selected === path && 'bg-accent text-foreground',
            )}
          >
            <FileIcon path={path} />
            <span className="min-w-0 flex-1 truncate text-left">{path.split('/').at(-1)}</span>
            <DiffAmounts stats={stats.get(path)} />
          </Button>
        ))}
    </>
  )
}
export function TaskFiles({
  task,
  onReference,
}: {
  task: Task
  onReference?: (text: string) => void
}) {
  const stats = useMemo(
    () => new Map(task.files.map((file) => [file.path, fileStats(file)])),
    [task.files],
  )
  const { request, connected } = useWorkspace()
  const [paths, setPaths] = useApplicationState<string[]>([])
  const [selected, setSelected] = useApplicationState('')
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [contents, setContents] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [revision, setRevision] = useApplicationState(0)
  useEffect(() => {
    if (!connected) return
    let active = true
    setLoading(true)
    void request('/api/tasks/files/list', { id: task.id }, responses.projectFileList)
      .then(
        (result) => {
          if (active) {
            setPaths(result.files)
            setError('')
          }
        },
        (cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [connected, request, task.id, revision])
  useEffect(() => {
    if (!selected || !connected) return
    let active = true
    setContents('')
    setLoading(true)
    void request('/api/tasks/files/read', { id: task.id, path: selected }, responses.projectFile)
      .then(
        (result) => {
          if (active) {
            setContents(result.contents)
            setError('')
          }
        },
        (cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [connected, request, task.id, selected, revision])
  const root = useMemo(() => tree(paths), [paths])
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
      {error && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              {loading ? (
                <p className="p-4 text-xs text-muted-foreground">Loading file…</p>
              ) : (
                <HighlightedFile
                  key={`${selected}:${revision}`}
                  taskId={task.id}
                  path={selected}
                  contents={contents}
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
        <aside
          aria-label="Project file tree"
          className="flex w-64 max-w-[40%] shrink-0 flex-col border-l bg-sidebar"
        >
          <div className="border-b px-3 py-3 text-xs font-medium">Files</div>
          <div className="min-h-0 overflow-auto p-2">
            <DirectoryRows node={root} selected={selected} select={setSelected} stats={stats} />
          </div>
        </aside>
      </div>
    </section>
  )
}
