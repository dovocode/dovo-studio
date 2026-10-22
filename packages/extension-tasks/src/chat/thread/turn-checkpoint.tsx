import { whitespaceOnlyFile } from '@dovo/studio-core'
import { SavedFilePreview } from '../../files/saved-file-preview'
import { checkpointFiles, changedFileBreakdown, filePreviewLabel } from '@dovo/protocol'
import { fileStats, DiffAmounts } from '../../files/presentation'
import { responses, useWorkspace, useAppPreferences } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo } from 'react'
import { getFiletypeFromFileName, parseDiffFromFile } from '@pierre/diffs'
import { preloadStudioHighlighter, useDiffOptions } from '@dovo/studio-ui/code-themes'
import { FileDiff } from '@pierre/diffs/react'
import { BookmarkCheck, ChevronRight, Undo2 } from 'lucide-react'
import { useTurnDisclosure } from './turn-window'
import type { ChangedFile, TaskTurn } from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorBoundary,
  FileBrowserTree,
} from '@dovo/studio-ui'
export function CheckpointDiff({ file }: { file: ChangedFile }) {
  const [ready, setReady] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [attempt, setAttempt] = useApplicationState(0)
  const diffs = useDiffOptions()
  const [split, setSplit] = useApplicationState(diffs.defaultSplit)
  const [overflow, setOverflow] = useApplicationState(diffs.options.overflow)
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
    [file.path, file.before, file.after],
  )
  const stats = useMemo(() => fileStats(file), [file])
  useEffect(() => {
    let active = true
    setReady(false)
    setError('')
    void preloadStudioHighlighter(getFiletypeFromFileName(file.path))
      .then(() => {
        if (active) setReady(true)
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [file.path, attempt])
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </span>
        <DiffAmounts stats={stats} />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[0.6875rem]"
          aria-label="Split diff"
          aria-pressed={split}
          onClick={() => setSplit((value) => !value)}
        >
          {split ? 'Split' : 'Unified'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[0.6875rem]"
          aria-label="Wrap diff lines"
          aria-pressed={overflow === 'wrap'}
          onClick={() => setOverflow((value) => (value === 'wrap' ? 'scroll' : 'wrap'))}
        >
          Wrap
        </Button>
      </div>
      <div
        className="studio-code min-h-0 min-w-0 flex-1 overflow-auto"
        aria-label="Saved file diff"
      >
        {error ? (
          <div className="space-y-3 p-3 text-xs">
            <p role="alert" className="break-words text-destructive">
              Highlighting unavailable. {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Retry highlighting
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['before', 'after'] as const).map((side) => (
                <section key={side} className="min-w-0 rounded-md border">
                  <h3 className="border-b px-3 py-2 font-medium">
                    {side === 'before' ? 'Before' : 'After'}
                  </h3>
                  <pre className="overflow-auto whitespace-pre-wrap break-words p-3">
                    {file[side] || '(empty file)'}
                  </pre>
                </section>
              ))}
            </div>
          </div>
        ) : file.before === file.after ? (
          <p className="p-4 text-xs text-muted-foreground">
            No text changes. This file was added, removed, or its file mode changed.
          </p>
        ) : ready ? (
          <FileDiff
            fileDiff={diff}
            options={{
              ...diffs.options,
              overflow,
              diffStyle: split ? 'split' : 'unified',
              disableFileHeader: true,
            }}
          />
        ) : (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            Loading diff…
          </p>
        )}
      </div>
    </div>
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
  const [expanded, setExpanded] = useTurnDisclosure(`checkpoint:${checkoutId ?? ''}:${turn.id}`)
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
  const treeFiles = useMemo(() => {
    const amounts = new Map(stats.map((stat) => [stat.path, stat]))
    return files.map((file) => ({
      path: file.path,
      additions: amounts.get(file.path)?.additions,
      deletions: amounts.get(file.path)?.deletions,
      label: file.preview ? filePreviewLabel(file) : undefined,
    }))
  }, [files, stats])
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
  const file = files.find((entry) => entry.path === selected) ?? files[0]
  const count = files.length
  // Show checkpoint controls only once the turn has a result to inspect.
  if ((!checkpoint.after && !checkpoint.error) || (!count && checkpoint.after && !checkpoint.error))
    return null
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
      {!!count && (
        <p aria-label="Changed file breakdown" className="mt-1 tabular-nums">
          {changedFileBreakdown(files)}
        </p>
      )}
      {showFiles && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <FileBrowserTree
            files={treeFiles}
            selected={selected}
            defaultExpandedDepth={0}
            onSelect={(path) => {
              setSelected(path)
              setOpen(true)
            }}
          />
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85dvh] max-w-7xl flex-col gap-0 overflow-hidden p-0">
          <div className="shrink-0 space-y-1 border-b px-4 py-3 pr-12">
            <DialogTitle className="text-sm">
              Turn checkpoint · {count} {count === 1 ? 'file' : 'files'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Saved changes from this turn. Edits that existed before the turn are preserved in the
              starting snapshot.
            </DialogDescription>
          </div>
          {checkpoint.error && (
            <p role="alert" className="text-xs text-destructive">
              {checkpoint.error}
            </p>
          )}
          {file && taskId && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
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
          <div className="shrink-0 border-b px-3 py-2 md:hidden">
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
          </div>
          <div className="flex min-h-0 min-w-0 flex-1">
            <aside
              aria-label="Checkpoint files"
              className="hidden min-h-0 w-60 shrink-0 overflow-y-auto border-r bg-muted/10 p-2 md:block"
            >
              <FileBrowserTree
                files={treeFiles}
                selected={file?.path}
                onSelect={setSelected}
                defaultExpandedDepth={1}
              />
            </aside>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {file ? (
                <ErrorBoundary key={file.path}>
                  {file.preview ? (
                    <div className="h-full overflow-auto">
                      <SavedFilePreview
                        key={file.path}
                        file={file}
                        taskId={taskId}
                        turnId={turn.id}
                        checkoutId={checkoutId}
                      />
                    </div>
                  ) : (
                    <CheckpointDiff key={file.path} file={file} />
                  )}
                </ErrorBoundary>
              ) : (
                <p className="p-4 text-xs text-muted-foreground">No changed files.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
