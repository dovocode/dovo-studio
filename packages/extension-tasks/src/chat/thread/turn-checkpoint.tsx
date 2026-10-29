import { CheckpointDiff } from '../../files/saved-file-diff'
export { CheckpointDiff } from '../../files/saved-file-diff'
import { whitespaceOnlyFile } from '@dovo/studio-core'
import { SavedFilePreview } from '../../files/saved-file-preview'
import { checkpointFiles, pullFileKind, type FileKind, filePreviewLabel } from '@dovo/protocol'
import { fileStats } from '../../files/presentation'
import { responses, useWorkspace, useAppPreferences } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useMemo } from 'react'
import { ChevronRight, Undo2 } from 'lucide-react'
import { useTurnDisclosure } from './turn-window'
import type { TaskTurn } from '@dovo/studio-core'
import {
  Button,
  ChangeSummary,
  ChangeTypeFilters,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorBoundary,
  FileBrowserTree,
} from '@dovo/studio-ui'
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
  const [kind, setKind] = useApplicationState<FileKind | undefined>(undefined)
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
  const filtered = useMemo(
    () => files.filter((file) => !kind || pullFileKind(file) === kind),
    [files, kind],
  )
  const stats = useMemo(() => files.filter((file) => !file.preview).map(fileStats), [files])
  const breakdownFiles = useMemo(() => {
    const amounts = new Map(stats.map((stat) => [stat.path, stat]))
    return files.map((file) => ({ ...file, ...amounts.get(file.path) }))
  }, [files, stats])
  const treeFiles = useMemo(() => {
    const amounts = new Map(stats.map((stat) => [stat.path, stat]))
    return filtered.map((file) => ({
      changeKind: pullFileKind(file),
      path: file.path,
      additions: amounts.get(file.path)?.additions,
      deletions: amounts.get(file.path)?.deletions,
      label: file.preview ? filePreviewLabel(file) : undefined,
    }))
  }, [filtered, stats])
  const checkpoint = turn.checkpoint
  if (!checkpoint) return null
  const undone = !!checkpoint.undone
  const file = filtered.find((entry) => entry.path === selected) ?? filtered[0]
  const count = files.length
  const title = undone
    ? 'Changes undone'
    : checkpoint.error
      ? 'Checkpoint incomplete'
      : `${count} ${count === 1 ? 'file' : 'files'} changed`
  // Show checkpoint controls only once the turn has a result to inspect.
  if ((!checkpoint.after && !checkpoint.error) || (!count && checkpoint.after && !checkpoint.error))
    return null
  return (
    <div className="mt-2 w-full text-xs text-muted-foreground">
      <ChangeSummary
        files={breakdownFiles}
        expanded={showFiles}
        onExpandedChange={setExpanded}
        value={kind}
        onChange={setKind}
        title={projectName ? `${projectName} · ${title}` : title}
        actions={
          (!!count || checkpoint.error) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(true)}
            >
              Open diff <ChevronRight className="size-3" />
            </Button>
          )
        }
      >
        {!!count && (
          <div className="studio-change-file-tree">
            <FileBrowserTree
              files={treeFiles}
              selected={selected}
              defaultExpandedDepth={0}
              showChangeBars
              onSelect={(path) => {
                setSelected(path)
                setOpen(true)
              }}
            />
          </div>
        )}
        {checkpoint.error && (
          <p role="alert" className="px-3 pb-2 text-xs text-destructive">
            {checkpoint.error}
          </p>
        )}
      </ChangeSummary>
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
          <ChangeTypeFilters
            files={breakdownFiles}
            weightBy="lines"
            value={kind}
            onChange={setKind}
          />
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
                {filtered.map((entry) => (
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
