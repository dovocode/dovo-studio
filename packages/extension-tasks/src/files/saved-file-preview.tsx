import { useEffect, useState } from 'react'
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
}: {
  file: ChangedFile
  taskId?: string
  turnId?: string
  checkoutId?: string
}) {
  const { request } = useWorkspace()
  const key = JSON.stringify([taskId, turnId, checkoutId, file.path])
  const [result, setResult] = useState<{
    key: string
    preview: FilePreview | null
    error: string
  } | null>(null)
  const preview = result?.key === key ? result.preview : null
  const error = result?.key === key ? result.error : ''
  useEffect(() => {
    let active = true
    if (!taskId) return
    void request(
      '/api/tasks/file/preview',
      { id: taskId, path: file.path, turnId, checkoutId },
      filePreviewSchema,
    ).then(
      (result) => {
        if (active) setResult({ key, preview: result, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setResult({
            key,
            preview: null,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, taskId, turnId, checkoutId, file.path, key])
  return (
    <div className="space-y-3 p-4 text-xs">
      <p className="text-muted-foreground">
        {filePreviewLabel(file)} ·{' '}
        {file.preview?.kind === 'submodule' ||
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
        <p role="status">Loading compact preview…</p>
      ) : null}
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
                  First 64 KB shown. Full contents remain in the snapshot.
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
