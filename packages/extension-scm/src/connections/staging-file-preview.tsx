import { useEffect, useRef, useState } from 'react'
import {
  RuntimeRequestError,
  filePreviewSchema,
  fileSizeLabel,
  type FilePreview,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { PullPatch } from '../pulls/detail/patch'

export function StagingFilePreview({
  repositoryId,
  taskId,
  path,
  comparison,
  onBack,
}: {
  repositoryId: string
  taskId?: string
  path: string
  comparison: 'staged' | 'unstaged'
  onBack: () => void
}) {
  const { request, connected } = useWorkspace()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    preview?: FilePreview
    error?: string
    unsupported?: true
  } | null>(null)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => back.current?.focus(), [])
  useEffect(() => {
    let active = true
    setResult(null)
    if (connected)
      void request(
        '/api/scm/file-preview',
        { repositoryId, taskId, path, comparison },
        filePreviewSchema,
      ).then(
        (preview) => {
          if (active) setResult({ preview })
        },
        (error: unknown) => {
          if (active)
            setResult(
              error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)
                ? { unsupported: true }
                : { error: String(error) },
            )
        },
      )
    return () => {
      active = false
    }
  }, [request, connected, repositoryId, taskId, path, comparison, attempt])
  const preview = connected ? result?.preview : undefined
  const complete =
    preview &&
    [preview.before, preview.after].every(
      (side) => !side || (side.kind === 'text' && !side.truncated),
    )
  // PullPatch supplies safe filenames itself and expects only unified diff hunks.
  const hunkStart = preview?.patch?.search(/^@@ /m) ?? -1
  const patch = hunkStart >= 0 ? preview?.patch?.slice(hunkStart) : undefined
  return (
    <section
      aria-label={`${comparison === 'staged' ? 'Staged' : 'Unstaged'} file review`}
      className="min-w-0 space-y-3 pt-1"
    >
      <Button ref={back} size="sm" variant="ghost" onClick={onBack}>
        ← Back to staging
      </Button>
      <div>
        <h3 className="break-all font-mono text-xs font-medium">{path}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {comparison === 'staged'
            ? 'Staged changes · HEAD → index'
            : 'Unstaged changes · index → working file'}
        </p>
      </div>
      {!connected ? (
        <p role="status" className="text-xs text-muted-foreground">
          Connect to the runtime to review this file.
        </p>
      ) : result?.unsupported ? (
        <p role="status" className="text-xs text-muted-foreground">
          Update Dovo on this computer to review staged and unstaged changes. Your commit draft and
          selections are kept.
        </p>
      ) : result?.error ? (
        <div className="space-y-2 text-xs">
          <p role="alert" className="break-words text-destructive">
            Could not load this comparison: {result.error}
          </p>
          <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </Button>
        </div>
      ) : !preview ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading comparison…
        </p>
      ) : (
        <div className="max-h-[50dvh] min-w-0 overflow-auto rounded-lg border">
          {complete && patch && preview.before?.text !== preview.after?.text ? (
            <PullPatch
              file={{
                path,
                patch,
                status: !preview.before ? 'added' : !preview.after ? 'removed' : 'modified',
                additions: 0,
                deletions: 0,
              }}
              split={false}
              allowInlineComment={false}
              allowInlineRange={false}
            />
          ) : (
            <div className="space-y-3 p-3 text-xs">
              {complete &&
                preview.before &&
                preview.after &&
                preview.before.text === preview.after.text && (
                  <p className="text-muted-foreground">
                    No text changes. The file mode or type may have changed.
                  </p>
                )}
              {(['before', 'after'] as const).map((name) => {
                const side = preview[name]
                return (
                  <section key={name} className="min-w-0 space-y-2">
                    <h4 className="font-medium">
                      {name === 'before'
                        ? comparison === 'staged'
                          ? 'HEAD'
                          : 'Index'
                        : comparison === 'staged'
                          ? 'Index'
                          : 'Working file'}
                      {side && ` · ${fileSizeLabel(side.size)}`}
                    </h4>
                    {!side ? (
                      <p className="text-muted-foreground">File absent.</p>
                    ) : side.image ? (
                      <img
                        src={side.image}
                        alt={`${name} preview of ${path}`}
                        className="max-h-64 max-w-full object-contain"
                      />
                    ) : side.text !== undefined ? (
                      <pre className="overflow-auto whitespace-pre-wrap break-all font-mono">
                        {side.text || '(empty file)'}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">
                        {side.notice ?? 'Binary file. No text preview available.'}
                      </p>
                    )}
                    {side?.truncated && (
                      <p className="text-muted-foreground">
                        First 64 KB shown. This compact preview omits the rest of this side.
                      </p>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
