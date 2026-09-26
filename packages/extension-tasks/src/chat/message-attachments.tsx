import { useApplicationState } from '@dovo/studio-core/state'
import { Paperclip, X } from 'lucide-react'
import { attachmentReadSchema, isImageAttachment, type Attachment } from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'
export function MessageAttachments({
  taskId,
  files = [],
  remove,
  disabled,
}: {
  taskId: string
  files?: Attachment[]
  remove?: (id: string) => Promise<void>
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
      className="flex flex-wrap gap-1.5 py-1"
      aria-label={remove ? 'Draft attachments' : 'Message attachments'}
    >
      {files.map((file) => (
        <div
          key={file.id}
          className="flex max-w-full items-center rounded-md border bg-secondary/40 text-[0.6875rem]"
        >
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 px-2 py-1.5"
            disabled={!connected || busy || disabled}
            onClick={() => void open(file.id)}
            aria-label={`Preview ${file.name}`}
          >
            <Paperclip className="size-3 shrink-0" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span>
          </button>
          {remove && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              aria-label={`Remove ${file.name}`}
              disabled={!connected || disabled}
              onClick={() => void remove(file.id)}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      ))}
      {!!error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-auto">
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
