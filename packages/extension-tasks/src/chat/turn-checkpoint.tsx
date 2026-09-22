import { useEffect, useMemo, useState } from 'react'
import { getFiletypeFromFileName, parseDiffFromFile, preloadHighlighter } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { BookmarkCheck, ChevronRight, Folder } from 'lucide-react'
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

function CheckpointDiff({ file }: { file: ChangedFile }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const diff = useMemo(
    () =>
      parseDiffFromFile(
        { name: file.path, contents: file.before },
        { name: file.path, contents: file.after },
      ),
    [file],
  )
  useEffect(() => {
    let active = true
    void preloadHighlighter({
      themes: ['pierre-dark'],
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
      options={{ theme: 'pierre-dark', themeType: 'dark', diffStyle: 'unified', overflow: 'wrap' }}
    />
  )
}

export function TurnCheckpoint({ turn }: { turn: TaskTurn }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const checkpoint = turn.checkpoint
  if (!checkpoint) return null
  const file = selected
    ? checkpoint.files.find((entry) => entry.path === selected)
    : checkpoint.files[0]
  const count = checkpoint.files.length + checkpoint.omitted.length
  // Successful turns without changes do not need a permanent checkpoint footer.
  if (!count && checkpoint.after && !checkpoint.error) return null
  const folders = new Map<string, string[]>()
  for (const path of [...checkpoint.files.map((entry) => entry.path), ...checkpoint.omitted]) {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Project root'
    const paths = folders.get(directory) ?? []
    paths.push(path)
    folders.set(directory, paths)
  }
  return (
    <div className="mt-2 w-full rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <BookmarkCheck className="size-3.5" />
        <span>
          {checkpoint.error
            ? 'Checkpoint incomplete'
            : !checkpoint.after
              ? 'Before-work snapshot saved'
              : count
                ? `${count} changed ${count === 1 ? 'file' : 'files'}`
                : 'Checkpoint · No file changes'}
        </span>
        {(!!count || checkpoint.error) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setOpen(true)}
          >
            Open diff
            <ChevronRight className="size-3" />
          </Button>
        )}
      </div>
      {Array.from(folders, ([directory, paths]) => (
        <details key={directory} className="mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1.5 hover:text-foreground">
            <ChevronRight size={12} />
            <Folder size={14} />
            <span className="min-w-0 flex-1 truncate font-mono" title={directory}>
              {directory}
            </span>
            <span className="tabular-nums">{paths.length}</span>
          </summary>
          <div className="ml-5 border-l pl-2">
            {paths.map((path) => (
              <button
                key={path}
                type="button"
                className="block w-full truncate rounded px-2 py-1.5 text-left font-mono hover:bg-muted hover:text-foreground"
                title={path}
                onClick={() => {
                  setSelected(path)
                  setOpen(true)
                }}
              >
                {path.slice(path.lastIndexOf('/') + 1)}
              </button>
            ))}
          </div>
        </details>
      ))}
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
          {!!checkpoint.omitted.length && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {checkpoint.omitted.length} files without text previews
              </summary>
              <p className="py-2">
                Binary files, symlinks, submodules and files beyond preview limits are listed here.
                Git snapshots retain repository file contents; submodules retain only their commit
                reference.
              </p>
              <ul>
                {checkpoint.omitted.map((path) => (
                  <li key={path} className="break-all font-mono">
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {file && (
            <ChoicePicker
              aria-label="Checkpoint file"
              value={file.path}
              onValueChange={setSelected}
            >
              {checkpoint.files.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.path}
                </option>
              ))}
            </ChoicePicker>
          )}
          <div className="studio-code min-h-0 flex-1 overflow-auto rounded-md border">
            {file ? (
              <ErrorBoundary key={file.path}>
                <CheckpointDiff key={file.path} file={file} />
              </ErrorBoundary>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No text diffs available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
