import { useEffect, useMemo } from 'react'
import { getFiletypeFromFileName } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useApplicationState } from '@dovo/studio-core/state'
import type { ChangedFile } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { preloadStudioHighlighter, useDiffOptions } from '@dovo/studio-ui/code-themes'
import { DiffAmounts } from './presentation'
import { parseSavedFileDiff } from './saved-file-diff-job'

export function CheckpointDiff({ file }: { file: ChangedFile }) {
  const [ready, setReady] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [attempt, setAttempt] = useApplicationState(0)
  const diffs = useDiffOptions()
  const [split, setSplit] = useApplicationState(diffs.defaultSplit)
  const [overflow, setOverflow] = useApplicationState(diffs.options.overflow)
  const [parsed, setParsed] = useApplicationState<{
    path: string
    before: string
    after: string
    diff: FileDiffMetadata | null
    error: boolean
  } | null>(null)
  const current =
    parsed?.path === file.path && parsed.before === file.before && parsed.after === file.after
      ? parsed
      : null
  const diff = current?.diff
  useEffect(() => {
    if (file.before === file.after) return
    const input = { path: file.path, before: file.before, after: file.after }
    return parseSavedFileDiff(input, (result) =>
      setParsed({ ...input, diff: result, error: !result }),
    )
  }, [file.path, file.before, file.after])
  const stats = useMemo(
    () =>
      diff
        ? {
            path: file.path,
            additions: diff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
            deletions: diff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
          }
        : undefined,
    [diff, file.path],
  )
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
        {error || current?.error ? (
          <div className="space-y-3 p-3 text-xs">
            <p role="alert" className="break-words text-destructive">
              {error
                ? `Highlighting unavailable. ${error}`
                : 'This diff could not be computed within the viewer limit. Complete contents are shown below.'}
            </p>
            {error && (
              <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                Retry highlighting
              </Button>
            )}
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
        ) : ready && diff ? (
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
