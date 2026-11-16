import { useEffect, useRef, useState } from 'react'
import { ScanText } from 'lucide-react'
import { attachmentReadSchema, attachmentOcrResultSchema, type Attachment } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'
import { ImageViewer } from '@dovo/studio-ui/image-viewer'

export function ImageOcr({
  taskId,
  file,
  disabled,
  attachText,
}: {
  taskId: string
  file: Attachment
  disabled?: boolean
  attachText?: (text: string, name: string) => Promise<void>
}) {
  const { request, connected, connection } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  useEffect(() => {
    setOpen(false)
    setText(null)
    setImage('')
    setError('')
    return () => {
      generation.current++
    }
  }, [taskId, file.id, connection?.address, connection?.token, connection?.runtimeId])
  const extract = async () => {
    setOpen(true)
    if (lock.current || text !== null) return
    lock.current = true
    setBusy(true)
    setError('')
    const current = generation.current
    try {
      const source = await request(
        '/api/attachments/read',
        { taskId, id: file.id },
        attachmentReadSchema,
      )
      if (current !== generation.current) return
      setImage(`data:${source.attachment.mime};base64,${source.data}`)
      const result = await request(
        '/api/attachments/ocr',
        { taskId, id: file.id },
        attachmentOcrResultSchema,
      )
      if (current === generation.current) setText(result.text)
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 rounded-md text-muted-foreground [@media(pointer:coarse)]:size-11"
        aria-label={`Extract text from ${file.name}`}
        title="Extract text"
        disabled={!connected || disabled}
        onClick={() => void extract()}
      >
        <ScanText className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-auto">
          <DialogTitle>Text from {file.name}</DialogTitle>
          <DialogDescription>
            Extracted on your Studio computer. Check the text before using it.
          </DialogDescription>
          {image && <ImageViewer src={image} alt={file.name} className="h-[30dvh] min-h-32" />}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Extracting text…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {text !== null && (
            <>
              <textarea
                aria-label="Extracted text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="min-h-32 w-full rounded-lg border bg-background p-3 text-sm"
              />
              {!text && (
                <p role="status" className="text-sm text-muted-foreground">
                  No text found.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {error && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !connected}
                onClick={() => void extract()}
              >
                Try again
              </Button>
            )}
            {attachText && (
              <Button
                type="button"
                disabled={busy || disabled || !connected || !text?.trim()}
                onClick={() => {
                  if (!text?.trim()) return
                  setOpen(false)
                  void attachText(
                    text,
                    `${file.name.replace(/\.[^.]+$/, '').slice(0, 220)}-ocr.txt`,
                  ).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                    setOpen(true)
                  })
                }}
              >
                Attach text file
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
