import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChatImageEditContext, type ChatImageUpload } from './chat-image-edit-context'
import { useWorkspace } from '@dovo/studio-core'
import {
  attachmentReadSchema,
  taskImageReadSchema,
  chatImageData,
  chatImageName,
  ATTACHMENT_IMAGE_MAX_SOURCE_BYTES,
  type ChatImageSource,
} from '@dovo/protocol'
import { Dialog, DialogContent, DialogTitle } from '@dovo/studio-ui'

export function ChatImageEditProvider({
  children,
  disabled = false,
  onEdit,
}: {
  children: ReactNode
  disabled?: boolean
  onEdit?: () => void
}) {
  const { request, connected, connection } = useWorkspace()
  const uploader = useRef<ChatImageUpload | null>(null)
  const [available, setAvailable] = useState(false)
  const [register] = useState(() => (upload: ChatImageUpload | null) => {
    uploader.current = upload
    setAvailable(!!upload)
  })
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    controller.current?.abort()
    setError('')
  }, [connection?.address, connection?.token])
  const edit = async (source: ChatImageSource, label: string) => {
    if (locked.current || disabled || !uploader.current) return
    locked.current = true
    setBusy(true)
    setError('')
    const upload = uploader.current
    const operation = new AbortController()
    controller.current = operation
    try {
      onEdit?.()
      if (!connected) throw new Error('Reconnect to edit and attach images.')
      let uri: string
      if ('uri' in source) uri = source.uri
      else if ('attachmentId' in source) {
        const result = await request(
          '/api/attachments/read',
          { taskId: source.taskId, id: source.attachmentId },
          attachmentReadSchema,
        )
        uri = `data:${result.attachment.mime};base64,${result.data}`
      } else uri = (await request('/api/tasks/images/read', source, taskImageReadSchema)).uri
      let file: File
      if (uri.startsWith('data:')) {
        const { data, mime, extension } = chatImageData(uri)
        file = new File(
          [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
          chatImageName(label, extension),
          { type: mime },
        )
      } else {
        if (!/^https?:\/\//i.test(uri)) throw new Error('This image URL cannot be edited.')
        const result = await fetch(uri, { credentials: 'omit', signal: operation.signal })
        if (!result.ok) throw new Error('Could not download this image for editing.')
        if (Number(result.headers.get('content-length')) > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
          throw new Error('Choose an image up to 50 MB to edit.')
        const blob = await result.blob()
        if (blob.size > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
          throw new Error('Choose an image up to 50 MB to edit.')
        const mime = blob.type.split(';')[0] ?? ''
        if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(mime))
          throw new Error('This image format cannot be edited.')
        file = new File(
          [blob],
          chatImageName(label, mime === 'image/jpeg' ? 'jpg' : mime.slice(6)),
          { type: mime },
        )
      }
      if (!operation.signal.aborted) await upload(file)
    } catch (cause) {
      if (!operation.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <ChatImageEditContext value={{ edit, busy, disabled, available, register }}>
      {children}
      <Dialog
        open={!!error}
        onOpenChange={(open) => {
          if (!open) setError('')
        }}
      >
        <DialogContent>
          <DialogTitle>Couldn’t attach image</DialogTitle>
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
        </DialogContent>
      </Dialog>
    </ChatImageEditContext>
  )
}
