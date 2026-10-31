import {
  createRuntimeClient,
  filePreviewSchema,
  taskFileShareSchema,
  taskImageReadSchema,
} from '@dovo/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function ProjectImagePreview({
  taskId,
  checkoutId,
  path,
  onOpenOriginal,
  refreshRevision,
}: {
  taskId: string
  checkoutId?: string
  path: string
  onOpenOriginal: () => void
  refreshRevision: number
}) {
  const { request, connection, connected } = useWorkspace()
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; uri?: string; error?: string }>()
  const key = JSON.stringify([
    taskId,
    checkoutId,
    path,
    connection?.address,
    connection?.token,
    revision,
    refreshRevision,
  ])
  useEffect(() => {
    if (!connected || !connection) return
    let active = true
    const load = async () => {
      if (checkoutId) {
        const preview = await request(
          '/api/tasks/files/preview',
          { id: taskId, path, checkoutId },
          filePreviewSchema,
        )
        if (!preview.after?.image)
          throw new Error(preview.after?.notice ?? 'Image preview unavailable.')
        return preview.after.image
      }
      // Use bounded thumbnails for the formats supported by the runtime image decoder.
      if (/\.(png|jpe?g|gif|webp)$/i.test(path)) {
        const { uri } = await request(
          '/api/tasks/images/read',
          { taskId, path, maxSize: 2048 },
          taskImageReadSchema,
        )
        return uri
      }
      const { url } = await request('/api/tasks/files/share', { taskId, path }, taskFileShareSchema)
      return createRuntimeClient(connection).url(`${url}?content=1`)
    }
    void load().then(
      (uri) => {
        if (active) setResult({ key, uri })
      },
      (cause: unknown) => {
        if (active)
          setResult({ key, error: cause instanceof Error ? cause.message : String(cause) })
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, connection, taskId, checkoutId, path, key])
  const current = result?.key === key ? result : undefined
  const error = !connected ? 'Reconnect to preview this image.' : current?.error
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {path}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!connected || !!checkoutId}
          onClick={onOpenOriginal}
        >
          Open original
        </Button>
      </header>
      {error ? (
        <div role="alert" className="space-y-3 p-4 text-sm">
          <p>{error}</p>
          <Button disabled={!connected} onClick={() => setRevision((value) => value + 1)}>
            Retry file
          </Button>
        </div>
      ) : current?.uri ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={current.uri}
            alt={path}
            referrerPolicy="no-referrer"
            className="max-h-full max-w-full object-contain"
            onError={() =>
              setResult({ key, error: 'Could not load this image. Retry or open the original.' })
            }
          />
        </div>
      ) : (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          Loading image…
        </p>
      )}
    </div>
  )
}
