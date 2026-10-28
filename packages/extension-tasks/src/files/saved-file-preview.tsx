import { Button } from '@dovo/studio-ui'
import { CheckpointDiff } from './saved-file-diff'
import { useEffect, useMemo, useState } from 'react'
import {
  filePreviewLabel,
  filePreviewSchema,
  fileSizeLabel,
  type FilePreview,
  type ChangedFile,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'

export function SavedFilePreview({
  file,
  taskId,
  turnId,
  checkoutId,
  working = false,
}: {
  file: ChangedFile
  taskId?: string
  turnId?: string
  checkoutId?: string
  working?: boolean
}) {
  const { request, activeRuntimeId, connection } = useWorkspace()
  const [fullKey, setFullKey] = useState('')
  const [attempt, setAttempt] = useState(0)
  const ownerKey = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    taskId,
    turnId,
    checkoutId,
    working,
    file.path,
  ])
  const full = fullKey === ownerKey
  const key = JSON.stringify([ownerKey, full, attempt])
  const [result, setResult] = useState<{
    key: string
    file: ChangedFile
    preview: FilePreview | null
    error: string
  } | null>(null)
  const preview = result?.key === key && result.file === file ? result.preview : null
  const completeText =
    preview &&
    [preview.before, preview.after].every(
      (side) => !side || (side.kind === 'text' && !side.truncated),
    )
  const diff = useMemo(
    () =>
      completeText
        ? {
            path: file.path,
            before: preview.before?.text ?? '',
            after: preview.after?.text ?? '',
            viewed: false,
          }
        : null,
    [completeText, preview, file.path],
  )
  const error = result?.key === key && result.file === file ? result.error : ''
  useEffect(() => {
    let active = true
    if (!taskId) return
    void request(
      '/api/tasks/file/preview',
      { id: taskId, path: file.path, turnId, checkoutId, working, full },
      filePreviewSchema,
    ).then(
      (result) => {
        if (active) setResult({ key, file, preview: result, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setResult({
            key,
            file,
            preview: null,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, taskId, turnId, checkoutId, working, file.path, key, full, file])
  if (diff) return <CheckpointDiff file={diff} />
  return (
    <div className="space-y-3 p-4 text-xs">
      <p className="text-muted-foreground">
        {filePreviewLabel(file)} ·{' '}
        {working
          ? 'Current working checkout · preview only.'
          : file.preview?.kind === 'submodule' ||
              preview?.before?.kind === 'submodule' ||
              preview?.after?.kind === 'submodule'
            ? 'Submodule commit references saved in Git.'
            : 'Full contents saved in Git.'}
      </p>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : !preview && taskId ? (
        <p role="status">{full ? 'Loading full diff…' : 'Loading compact preview…'}</p>
      ) : null}
      {((preview &&
        [preview.before, preview.after].some((side) => side?.kind === 'text' && side.truncated)) ||
        error) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setFullKey(ownerKey)
            setAttempt((value) => value + 1)
          }}
        >
          {full ? 'Retry full diff' : 'Load full diff'}
        </Button>
      )}
      {full && (preview?.before?.truncated || preview?.after?.truncated) && (
        <p className="text-muted-foreground">
          This computer returned only a compact preview. Update it to load larger text diffs.
        </p>
      )}
      {full && (
        <Button size="sm" variant="ghost" onClick={() => setFullKey('')}>
          Show compact preview
        </Button>
      )}
      {(full || preview?.before?.truncated || preview?.after?.truncated) && (
        <p className="text-muted-foreground">
          Text diffs support up to 8 MB per side.{' '}
          {working ? 'The working file is unchanged.' : 'Full snapshots remain saved.'}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['before', 'after'] as const).map((name) => {
          const side = preview?.[name]
          const metadata = file.preview?.[name]
          return (
            <section key={name} className="min-w-0 rounded-md border p-3">
              <p className="mb-2 font-medium">
                {name === 'before' ? 'Before' : 'After'}
                {(side || metadata) && side?.kind !== 'submodule' && metadata?.mode !== '160000'
                  ? ` · ${fileSizeLabel(side?.size ?? metadata?.size ?? 0)}`
                  : ''}
              </p>
              {side?.image ? (
                <img
                  src={side.image}
                  alt={`${name} preview of ${file.path}`}
                  className="max-h-96 max-w-full object-contain"
                />
              ) : side?.text !== undefined ? (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono">
                  {side.text || '(empty file)'}
                </pre>
              ) : side ? (
                <p className="text-muted-foreground">
                  {side.notice ?? 'Binary contents saved. No text preview.'}
                </p>
              ) : preview ? (
                <p className="text-muted-foreground">File absent.</p>
              ) : metadata ? (
                <p className="break-all font-mono text-muted-foreground">{metadata.hash}</p>
              ) : null}
              {side?.truncated && (
                <p className="mt-2 text-muted-foreground">
                  First 64 KB shown. Load the full diff to compare changes beyond this preview.
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
