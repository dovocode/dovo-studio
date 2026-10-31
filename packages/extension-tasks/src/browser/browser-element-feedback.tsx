import { useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import {
  browserElementDraft,
  type BrowserElement,
  type BrowserElementCapture,
  type BrowserElementPoint,
} from '@dovo/protocol'
import { updateTask, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@dovo/studio-ui'
import { useScreenshotAttachment } from './screenshot-attachment'

async function cropElement(capture: BrowserElementCapture, element: BrowserElement) {
  const image = new Image()
  image.src = capture.image
  await image.decode()
  const { snapshot } = capture
  const scaleX = image.naturalWidth / snapshot.width
  const scaleY = image.naturalHeight / snapshot.height
  const left = Math.max(0, element.rect.x - 12)
  const top = Math.max(0, element.rect.y - 12)
  const right = Math.min(snapshot.width, element.rect.x + element.rect.width + 12)
  const bottom = Math.min(snapshot.height, element.rect.y + element.rect.height + 12)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((right - left) * scaleX)
  canvas.height = Math.ceil((bottom - top) * scaleY)
  if (canvas.width <= 0 || canvas.height <= 0 || canvas.width * canvas.height > 16000000)
    throw new Error('The selected image area is unavailable or too large.')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image cropping is unavailable.')
  context.drawImage(
    image,
    left * scaleX,
    top * scaleY,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/png')
}

/** Captures once, inspects a point without clicking the live page, then edits the draft. */
export function BrowserElementFeedback({
  taskId,
  enabled,
  capture,
  inspect,
}: {
  taskId: string
  enabled: boolean
  capture: () => Promise<BrowserElementCapture>
  inspect: (point: BrowserElementPoint) => Promise<BrowserElement>
}) {
  const store = useWorkspace()
  const attachments = useScreenshotAttachment(taskId)
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState<BrowserElementCapture | null>(null)
  const [element, setElement] = useState<BrowserElement | null>(null)
  const [point, setPoint] = useState({ x: 0.5, y: 0.5 })
  const [comment, setComment] = useState('Please update this element:')
  const [includeImage, setIncludeImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const upload = useRef<AbortController | null>(null)
  const draftAdded = useRef(false)
  const close = () => {
    generation.current++
    upload.current?.abort()
    if (draftAdded.current) setNotice('Element feedback added to the draft. Image not attached.')
    pending.current = false
    setOpen(false)
    setImage(null)
    setElement(null)
    setBusy(false)
  }
  useEffect(
    () => () => {
      generation.current++
      upload.current?.abort()
    },
    [],
  )
  const begin = async () => {
    if (pending.current) return
    pending.current = true
    const attempt = ++generation.current
    setOpen(true)
    draftAdded.current = false
    setImage(null)
    setElement(null)
    setError('')
    setNotice('')
    if (!open) {
      setComment('Please update this element:')
      setIncludeImage(false)
    }
    setBusy(true)
    try {
      const result = await capture()
      if (generation.current === attempt) setImage(result)
    } catch (cause) {
      if (generation.current === attempt) setError(String(cause))
    } finally {
      if (generation.current === attempt) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const select = async (next: { x: number; y: number }) => {
    if (!image || pending.current) return
    pending.current = true
    const attempt = generation.current
    setPoint(next)
    setElement(null)
    setBusy(true)
    setError('')
    try {
      const result = await inspect({ snapshot: image.snapshot, ...next })
      if (generation.current === attempt) setElement(result)
    } catch (cause) {
      if (generation.current === attempt) setError(String(cause))
    } finally {
      if (generation.current === attempt) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const add = async () => {
    if (!image || !element || pending.current || !enabled) return
    pending.current = true
    setBusy(true)
    setError('')
    const attempt = generation.current
    const controller = new AbortController()
    upload.current = controller
    // Insert the text first so a failed optional crop/upload cannot lose the request.
    try {
      store.setWorkspace((workspace) => {
        const task = workspace.tasks.find((task) => task.id === taskId)
        if (!task || task.archived) throw new Error('This thread is no longer available.')
        return updateTask(workspace, taskId, (current) => ({
          ...current,
          draft: [current.draft, browserElementDraft(image.snapshot, element, comment)]
            .filter(Boolean)
            .join('\n\n'),
        }))
      })
      draftAdded.current = true
      let message = 'Element feedback added to the thread draft.'
      if (includeImage) {
        try {
          const cropped = await cropElement(image, element)
          controller.signal.throwIfAborted()
          await attachments.attach(cropped, controller.signal)
        } catch (cause) {
          if (controller.signal.aborted) return
          message = `Element feedback added to the draft. The image could not be attached: ${String(cause)}`
        }
      }
      if (generation.current !== attempt) return
      close()
      setNotice(message)
    } catch (cause) {
      if (generation.current === attempt) setError(String(cause))
    } finally {
      if (generation.current === attempt) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  return (
    <>
      <IconButton
        type="button"
        label="Point at an element"
        disabled={!enabled || busy || attachments.busy}
        onClick={() => void begin()}
      >
        <ScanLine size={16} />
      </IconButton>
      {notice && (
        <p role="status" className="max-w-64 p-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogTitle>Give feedback on an element</DialogTitle>
          <DialogDescription>
            Select an element in the captured page, describe the change, then add it to your thread
            draft.
          </DialogDescription>
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {image ? 'Reading element…' : 'Capturing page…'}
            </p>
          )}
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          {image ? (
            <>
              <button
                type="button"
                aria-label="Page snapshot: click an element, or move the marker with arrow keys and press Enter"
                className="relative block w-full cursor-crosshair overflow-hidden rounded border"
                disabled={busy}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                    return
                  event.preventDefault()
                  const delta = event.shiftKey ? 0.1 : 0.02
                  setPoint((current) => ({
                    x: Math.min(
                      1,
                      Math.max(
                        0,
                        current.x +
                          (event.key === 'ArrowLeft'
                            ? -delta
                            : event.key === 'ArrowRight'
                              ? delta
                              : 0),
                      ),
                    ),
                    y: Math.min(
                      1,
                      Math.max(
                        0,
                        current.y +
                          (event.key === 'ArrowUp'
                            ? -delta
                            : event.key === 'ArrowDown'
                              ? delta
                              : 0),
                      ),
                    ),
                  }))
                }}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  void select(
                    event.detail === 0
                      ? point
                      : {
                          x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
                          y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
                        },
                  )
                }}
              >
                <img
                  src={image.image}
                  alt="Captured browser page"
                  className="block h-auto w-full"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/30"
                  style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                />
              </button>
              {element && (
                <>
                  <p className="break-words font-mono text-xs">{element.selector}</p>
                  <p className="break-words text-sm text-muted-foreground">
                    {element.label || element.text || element.tag}
                  </p>
                  <label className="grid gap-1 text-sm">
                    Requested change
                    <textarea
                      className="min-h-20 rounded border bg-background p-2"
                      value={comment}
                      maxLength={8000}
                      onChange={(event) => setComment(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeImage}
                      onChange={(event) => setIncludeImage(event.target.checked)}
                      disabled={busy}
                    />
                    Attach a cropped screenshot
                  </label>
                </>
              )}
            </>
          ) : (
            !busy && <Button onClick={() => void begin()}>Capture again</Button>
          )}
          <div className="flex justify-end gap-2">
            {image && (
              <Button variant="ghost" disabled={busy} onClick={() => void begin()}>
                Capture again
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              {draftAdded.current ? 'Skip image' : 'Cancel'}
            </Button>
            <Button disabled={!element || busy || !enabled} onClick={() => void add()}>
              Add to draft
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {attachments.editor}
    </>
  )
}
