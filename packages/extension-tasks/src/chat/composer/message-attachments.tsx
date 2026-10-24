import { useApplicationState } from '@dovo/studio-core/state'
import { EditChatImage } from './chat-image-edit-context'
import { useEffect, useRef } from 'react'
import { File, FileImage, X, Pencil } from 'lucide-react'
import {
  attachmentReadSchema,
  isImageAttachment,
  fileSizeLabel,
  type Attachment,
} from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'
export function MessageAttachments({
  taskId,
  files = [],
  remove,
  edit,
  disabled,
  previews,
  compact = false,
}: {
  taskId: string
  compact?: boolean
  files?: Attachment[]
  remove?: (id: string) => Promise<void>
  edit?: (id: string) => Promise<void>
  previews?: Map<string, string>
  disabled?: boolean
}) {
  const { request, connected } = useWorkspace()
  const [preview, setPreview] = useApplicationState<{
      attachment: Attachment
      data: string
    } | null>(null),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const open = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      setPreview(
        await request(
          '/api/attachments/read',
          {
            taskId,
            id,
          },
          attachmentReadSchema,
        ),
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  if (!files.length) return null
  return (
    <div
      className="flex min-w-0 flex-col gap-1 py-0.5"
      aria-label={remove ? 'Draft attachments' : 'Message attachments'}
    >
      <div className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex w-full min-w-0 shrink-0 items-center rounded-lg border border-border/60 bg-muted/30 px-1"
          >
            <button
              type="button"
              className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1 [@media(pointer:coarse)]:min-h-11 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              disabled={!connected || busy || disabled}
              onClick={() => void open(file.id)}
              aria-label={`Preview ${file.name}`}
              title={file.name}
            >
              {isImageAttachment(file) ? (
                previews?.get(file.id) ? (
                  <img
                    src={previews.get(file.id)}
                    alt={file.name}
                    className={`${compact ? 'size-6' : 'size-7'} shrink-0 rounded-md object-cover`}
                  />
                ) : (
                  <AttachmentThumbnail taskId={taskId} file={file} compact={compact} />
                )
              ) : (
                <span
                  className={`flex ${compact ? 'size-6' : 'size-7'} shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
                >
                  <File className="size-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{file.name}</span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {fileSizeLabel(file.size)}
                </span>
              </span>
            </button>
            {edit && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime) && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 rounded-md text-muted-foreground [@media(pointer:coarse)]:size-11"
                aria-label={`Edit ${file.name}`}
                disabled={!connected || busy || disabled}
                onClick={() => void edit(file.id)}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            {!remove && isImageAttachment(file) && (
              <EditChatImage compact source={{ taskId, attachmentId: file.id }} label={file.name} />
            )}
            {remove && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 rounded-md text-muted-foreground [@media(pointer:coarse)]:size-11"
                aria-label={`Remove ${file.name}`}
                disabled={!connected || busy || disabled}
                onClick={() => void remove(file.id)}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {!!error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85dvh] max-w-[var(--chat-max)] overflow-auto">
          <DialogTitle>{preview?.attachment.name}</DialogTitle>
          <DialogDescription>
            {preview?.attachment.mime} · {preview?.attachment.size} bytes
          </DialogDescription>
          {preview && isImageAttachment(preview.attachment) ? (
            <img
              className="max-h-[60dvh] object-contain"
              alt={preview.attachment.name}
              src={`data:${preview.attachment.mime};base64,${preview.data}`}
            />
          ) : (
            preview && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {textPreview(preview.data)}
              </pre>
            )
          )}
          {preview && !remove && isImageAttachment(preview.attachment) && (
            <EditChatImage
              source={{ taskId, attachmentId: preview.attachment.id }}
              label={preview.attachment.name}
              onEdit={() => setPreview(null)}
            />
          )}
          <Button
            type="button"
            onClick={() => {
              if (!preview) return
              const url = URL.createObjectURL(
                new Blob([Uint8Array.from(atob(preview.data), (c) => c.charCodeAt(0))], {
                  type: 'application/octet-stream',
                }),
              )
              const link = document.createElement('a')
              link.href = url
              link.download = preview.attachment.name
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            Download file
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function textPreview(data: string) {
  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
    }).decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    return text.includes('\0')
      ? 'Download this file to inspect its contents.'
      : text.slice(0, 32000) + (text.length > 32000 ? '\n… Preview truncated' : '')
  } catch {
    return 'Download this file to inspect its contents.'
  }
}

function AttachmentThumbnail({
  taskId,
  file,
  compact,
}: {
  taskId: string
  file: Attachment
  compact: boolean
}) {
  const { request, connected } = useWorkspace()
  const [src, setSrc] = useApplicationState('')
  const [failed, setFailed] = useApplicationState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!connected || !ref.current) return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void request('/api/attachments/read', { taskId, id: file.id }, attachmentReadSchema)
        .then((result) => {
          if (!cancelled) setSrc(`data:${file.mime};base64,${result.data}`)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    })
    observer.observe(ref.current)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [connected, request, taskId, file.id, file.mime])
  return (
    <span
      ref={ref}
      className={`flex ${compact ? 'size-6' : 'size-7'} shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground`}
    >
      {src ? (
        <img src={src} alt={file.name} className="size-full object-cover" />
      ) : (
        <FileImage
          className="size-4"
          aria-label={failed ? 'Preview unavailable; click to retry' : 'Loading image preview'}
        />
      )}
    </span>
  )
}
