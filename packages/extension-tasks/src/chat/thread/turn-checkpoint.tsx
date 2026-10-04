import { whitespaceOnlyFile } from '@dovo/studio-core'
import { SavedFilePreview } from '../../files/saved-file-preview'
import { checkpointFiles, filePreviewLabel } from '@dovo/protocol'
import { fileStats, FileIcon, DiffAmounts } from '../../files/presentation'
import { responses, useDiffOptions, useWorkspace, useAppPreferences } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo } from 'react'
import { getFiletypeFromFileName, parseDiffFromFile, preloadHighlighter } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { BookmarkCheck, ChevronRight, Folder, Undo2 } from 'lucide-react'
import type { ChangedFile, TaskTurn } from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorBoundary,
} from '@dovo/studio-ui'
export function CheckpointDiff({ file }: { file: ChangedFile }) {
  const [ready, setReady] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  // Hooks run before any early return; the count must match once the highlighter is ready.
  const diffs = useDiffOptions()
  const diff = useMemo(
    () =>
      parseDiffFromFile(
        {
          name: file.path,
          contents: file.before,
        },
        {
          name: file.path,
          contents: file.after,
        },
      ),
    [file],
  )
  useEffect(() => {
    let active = true
    void preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(file.path)],
    })
      .then(() => {
        if (active) setReady(true)
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [file.path])
  if (error)
    return (
      <p role="alert" className="p-3 text-sm text-destructive">
        {error}
      </p>
    )
  if (!ready)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        Loading diff…
      </p>
    )
  if (file.before === file.after)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No text changes. This file was added, removed, or its file mode changed.
      </p>
    )
  return (
    <FileDiff
      fileDiff={diff}
      options={{
        ...diffs.options,
        diffStyle: diffs.defaultSplit ? 'split' : 'unified',
      }}
    />
  )
}
export function TurnCheckpoint({
  turn,
  taskId,
  taskRunning = false,
  checkoutId,
  projectName,
}: {
  turn: TaskTurn
  taskId?: string
  taskRunning?: boolean
  checkoutId?: string
  projectName?: string
}) {
  const { collapseChangedFiles, hideWhitespaceChanges } = useAppPreferences()
  const [expanded, setExpanded] = useApplicationState<boolean | null>(null)
  const showFiles = expanded ?? !collapseChangedFiles
  const [open, setOpen] = useApplicationState(false)
  const [selected, setSelected] = useApplicationState('')
  const [restoring, setRestoring] = useApplicationState(false)
  const [restoreError, setRestoreError] = useApplicationState('')
  const { request, connected } = useWorkspace()
  const files = useMemo(
    () =>
      turn.checkpoint
        ? checkpointFiles(turn.checkpoint).filter(
            (file) => !hideWhitespaceChanges || !whitespaceOnlyFile(file),
          )
        : [],
    [turn.checkpoint, hideWhitespaceChanges],
  )
  const stats = useMemo(() => files.filter((file) => !file.preview).map(fileStats), [files])
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])
  const totals = stats.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
  const checkpoint = turn.checkpoint
  if (!checkpoint) return null
  const undone = !!checkpoint.undone
  const file = selected ? files.find((entry) => entry.path === selected) : files[0]
  const count = files.length
  // Show checkpoint controls only once the turn has a result to inspect.
  if ((!checkpoint.after && !checkpoint.error) || (!count && checkpoint.after && !checkpoint.error))
    return null
  const folders = new Map<string, string[]>()
  for (const path of files.map((entry) => entry.path)) {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const paths = folders.get(directory) ?? []
    paths.push(path)
    folders.set(directory, paths)
  }
  return (
    <div className="mt-2 w-full rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded text-left hover:text-foreground"
          aria-expanded={showFiles}
          onClick={() => setExpanded(!showFiles)}
        >
          <ChevronRight className={showFiles ? 'size-3 rotate-90' : 'size-3'} />
          <BookmarkCheck className="size-3.5" />
          <span>
            {projectName ? `${projectName} · ` : ''}
            {undone
              ? 'Changes undone'
              : checkpoint.error
                ? 'Checkpoint incomplete'
                : count
                  ? `${count} changed ${count === 1 ? 'file' : 'files'}`
                  : 'Checkpoint · No file changes'}
          </span>
          {!!stats.length && <DiffAmounts stats={totals} />}
        </button>
        <span className="ml-auto flex items-center gap-1">
          {(!!count || checkpoint.error) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(true)}
            >
              Open diff
              <ChevronRight className="size-3" />
            </Button>
          )}
        </span>
      </div>
      {showFiles && (
        <div className="mt-2">
          {(folders.get('') ?? []).map((path) => (
            <button
              key={path}
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono hover:bg-muted hover:text-foreground"
              onClick={() => {
                setSelected(path)
                setOpen(true)
              }}
            >
              <FileIcon path={path} />
              <span className="min-w-0 flex-1 truncate">{path}</span>
              {byPath.get(path)?.preview ? (
                <span className="text-[0.625rem] text-muted-foreground">
                  {filePreviewLabel(byPath.get(path))}
                </span>
              ) : (
                <DiffAmounts stats={stats.find((file) => file.path === path)} />
              )}
            </button>
          ))}
          {Array.from(folders)
            .filter(([directory]) => !!directory)
            .map(([directory, paths]) => (
              <details key={directory} className="mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1.5 hover:text-foreground">
                  <ChevronRight size={12} />
                  <Folder size={14} />
                  <span className="min-w-0 flex-1 truncate font-mono" title={directory}>
                    {directory}
                  </span>
                  <DiffAmounts
                    stats={stats
                      .filter((file) => paths.includes(file.path))
                      .reduce(
                        (sum, file) => ({
                          additions: sum.additions + file.additions,
                          deletions: sum.deletions + file.deletions,
                        }),
                        { additions: 0, deletions: 0 },
                      )}
                  />
                </summary>
                <div className="ml-5 border-l pl-2">
                  {paths.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono hover:bg-muted hover:text-foreground"
                      title={path}
                      onClick={() => {
                        setSelected(path)
                        setOpen(true)
                      }}
                    >
                      <FileIcon path={path} />
                      <span className="min-w-0 flex-1 truncate">
                        {path.slice(path.lastIndexOf('/') + 1)}
                      </span>
                      {byPath.get(path)?.preview ? (
                        <span className="text-[0.625rem] text-muted-foreground">
                          {filePreviewLabel(byPath.get(path))}
                        </span>
                      ) : (
                        <DiffAmounts stats={stats.find((file) => file.path === path)} />
                      )}
                    </button>
                  ))}
                </div>
              </details>
            ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85dvh] max-w-5xl flex-col gap-3">
          <DialogTitle className="text-sm">Turn checkpoint</DialogTitle>
          <DialogDescription className="text-xs">
            Changes between the snapshots taken before and after this turn. Existing edits are part
            of the starting snapshot. This is a saved, read-only diff.
          </DialogDescription>
          {checkpoint.error && (
            <p role="alert" className="text-xs text-destructive">
              {checkpoint.error}
            </p>
          )}
          {file && taskId && (
            <div className="flex items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                disabled={!connected || taskRunning || restoring || undone}
                title={
                  undone
                    ? 'This turn is already undone'
                    : 'Only this file goes back to how it was before this turn. The current file is saved first.'
                }
                onClick={() => {
                  setRestoring(true)
                  setRestoreError('')
                  void request(
                    '/api/tasks/file/restore',
                    { id: taskId, path: file.path, turnId: turn.id, checkoutId },
                    responses.ok,
                  )
                    .then(() => setRestoreError(`Reverted ${file.path}.`))
                    .catch((cause: unknown) =>
                      setRestoreError(cause instanceof Error ? cause.message : String(cause)),
                    )
                    .finally(() => setRestoring(false))
                }}
              >
                <Undo2 className="size-3" /> Revert this file
              </Button>
              {restoreError && <span className="text-muted-foreground">{restoreError}</span>}
            </div>
          )}
          {file && (
            <ChoicePicker
              aria-label="Checkpoint file"
              value={file.path}
              onValueChange={setSelected}
            >
              {files.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.path}
                </option>
              ))}
            </ChoicePicker>
          )}
          <div className="studio-code min-h-0 flex-1 overflow-auto rounded-md border">
            {file ? (
              <ErrorBoundary key={file.path}>
                {file.preview ? (
                  <SavedFilePreview
                    key={file.path}
                    file={file}
                    taskId={taskId}
                    turnId={turn.id}
                    checkoutId={checkoutId}
                  />
                ) : (
                  <CheckpointDiff key={file.path} file={file} />
                )}
              </ErrorBoundary>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No changed files.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
