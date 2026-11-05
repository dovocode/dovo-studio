import { ImageViewer } from '@dovo/studio-ui/image-viewer'
import { useApplicationState } from '@dovo/studio-core/state'
import { EditChatImage } from './chat-image-edit-context'
import { useContext, useEffect, useRef, useState } from 'react'
import { ConversationVisibilityContext } from '../conversation-visibility'
import { File, FileImage, X, Pencil } from 'lucide-react'
import {
  attachmentReadSchema,
  isImageAttachment,
  fileSizeLabel,
  type Attachment,
} from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@dovo/studio-ui'
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
  const visible = useContext(ConversationVisibilityContext)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const generation = useRef(0)
  const compactRow = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const row = compactRow.current
    const list = strip.current
    if (!compact || files.length !== 1 || !row || !list) {
      setOverflowing(false)
      return
    }
    const measure = () => setOverflowing(list.scrollWidth > row.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(list)
    measure()
    return () => observer.disconnect()
  }, [compact, files])
  const [preview, setPreview] = useApplicationState<{
      attachment: Attachment
      data: string
    } | null>(null),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const open = async (id: string) => {
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/attachments/read',
        {
          taskId,
          id,
        },
        attachmentReadSchema,
      )
      if (generation.current === current && !document.hidden && visibleRef.current)
        setPreview(result)
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!visible) {
      generation.current++
      setPreview((current) =>
        current && /^(audio|video)\//.test(current.attachment.mime) ? null : current,
      )
    }
  }, [visible])
  useEffect(() => {
    setPreview(null)
    return () => {
      generation.current++
    }
  }, [taskId])
  useEffect(() => {
    if (!busy && !preview) return
    const closeMedia = () => {
      generation.current++
      setPreview((current) =>
        current && /^(audio|video)\//.test(current.attachment.mime) ? null : current,
      )
    }
    const onVisibility = () => {
      if (document.hidden) closeMedia()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', closeMedia)
    onVisibility()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', closeMedia)
    }
  }, [busy, preview])
  if (!files.length) return null
  return (
    <div
      ref={compactRow}
      data-compact-attachments={compact || undefined}
      className={`flex min-w-0 py-0.5 ${compact ? 'flex-row items-center gap-2' : 'flex-col gap-1'}`}
      aria-label={remove ? 'Draft attachments' : 'Message attachments'}
    >
      {compact && (
        <span
          className={
            files.length > 1 || overflowing
              ? 'shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground'
              : 'sr-only'
          }
        >
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
      )}
      <div
        ref={strip}
        className={
          compact
            ? 'flex min-w-0 flex-1 flex-row flex-nowrap! gap-1 overflow-x-auto overscroll-contain'
            : 'flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain'
        }
      >
        {files.map((file) => (
          <div
            key={file.id}
            className={`flex min-w-0 shrink-0 items-center border ${compact ? 'max-w-52 rounded-md border-border/50 bg-muted/20 px-0.5' : 'w-full rounded-lg border-border/60 bg-muted/30 px-1'}`}
          >
            <button
              type="button"
              className={`flex min-w-0 flex-1 items-center rounded-md px-1 [@media(pointer:coarse)]:min-h-11 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 ${compact ? 'min-h-7 gap-1.5' : 'min-h-8 gap-2'}`}
              disabled={!connected || busy || disabled}
              onClick={() => void open(file.id)}
              aria-label={`Preview ${file.name}`}
              title={`${file.name} · ${fileSizeLabel(file.size)}`}
            >
              {isImageAttachment(file) ? (
                previews?.get(file.id) ? (
                  <img
                    src={previews.get(file.id)}
                    alt={file.name}
                    className={`${compact ? 'size-5 rounded' : 'size-7 rounded-md'} shrink-0 border border-border object-cover`}
                  />
                ) : (
                  <AttachmentThumbnail taskId={taskId} file={file} compact={compact} />
                )
              ) : (
                <span
                  className={`flex ${compact ? 'size-5 rounded' : 'size-7 rounded-md'} shrink-0 items-center justify-center bg-muted text-muted-foreground`}
                >
                  <File className="size-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`min-w-0 flex-1 truncate ${compact ? 'text-xs' : 'text-[0.8125rem] font-medium'}`}
                >
                  {file.name}
                </span>
                {!compact && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fileSizeLabel(file.size)}
                  </span>
                )}
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
            {preview?.attachment.mime} · {preview && fileSizeLabel(preview.attachment.size)}
          </DialogDescription>
          {preview && isImageAttachment(preview.attachment) ? (
            <ImageViewer
              className="h-[55dvh] min-h-48"
              alt={preview.attachment.name}
              src={`data:${preview.attachment.mime};base64,${preview.data}`}
            />
          ) : preview && /^(audio|video)\//.test(preview.attachment.mime) ? (
            visible && <AttachmentMedia key={preview.attachment.id} {...preview} />
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
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function AttachmentMedia({ attachment, data }: { attachment: Attachment; data: string }) {
  const ref = useRef<HTMLMediaElement>(null)
  const [status, setStatus] = useApplicationState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const media = ref.current
    const stop = () => media?.pause()
    const onVisibility = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', stop)
    return () => {
      stop()
      media?.removeAttribute('src')
      media?.load()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', stop)
    }
  }, [])
  const props = {
    controls: true,
    preload: 'metadata' as const,
    src: `data:${attachment.mime};base64,${data}`,
    'aria-label': `Play ${attachment.name}`,
    onLoadedMetadata: () => setStatus('ready'),
    onError: () => setStatus('error'),
    className: 'max-h-[60dvh] w-full',
  }
  return (
    <div>
      {attachment.mime.startsWith('video/') ? (
        <video
          ref={(element) => {
            ref.current = element
          }}
          {...props}
        />
      ) : (
        <audio
          ref={(element) => {
            ref.current = element
          }}
          {...props}
        />
      )}
      {status === 'loading' && <p role="status">Loading media…</p>}
      {status === 'error' && (
        <p role="alert">Unable to play this file. Download it to open elsewhere.</p>
      )}
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
      className={`flex ${compact ? 'size-5 rounded' : 'size-7 rounded-md'} shrink-0 items-center justify-center overflow-hidden border border-border bg-muted text-muted-foreground`}
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
