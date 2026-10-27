import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Grip, Maximize2, Minimize2, PanelRight, PictureInPicture2, X } from 'lucide-react'
import { cn, IconButton } from '@dovo/studio-ui'

export type PreviewPlacement = 'inline' | 'floating' | 'expanded'
type Frame = { x: number; y: number; width: number; height: number }
const bounds = (frame: Frame): Frame => {
  const top =
    8 +
    (parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--studio-window-top-inset'),
    ) || 0)
  const width = Math.min(Math.max(280, frame.width), Math.max(0, window.innerWidth - 16))
  const height = Math.min(Math.max(220, frame.height), Math.max(0, window.innerHeight - top - 8))
  return {
    width,
    height,
    x: Math.max(8, Math.min(window.innerWidth - width - 8, frame.x)),
    y: Math.max(top, Math.min(window.innerHeight - height - 8, frame.y)),
  }
}
const initialFrame = (centered: boolean): Frame => {
  if (typeof window === 'undefined') return { x: 8, y: 8, width: 460, height: 380 }
  const width = Math.min(1120, window.innerWidth * 0.85)
  const height = Math.min(800, window.innerHeight * 0.85)
  return bounds(
    centered
      ? { x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2, width, height }
      : { x: window.innerWidth - 480, y: window.innerHeight - 420, width: 460, height: 380 },
  )
}

/** Keep the same preview mounted when moving it between the thread and floating view. */
export function FloatingPreview({
  title,
  placement,
  onPlacementChange,
  onClose,
  actions,
  children,
  inlineClassName = 'h-96',
  returnLabel = 'Return to thread',
  hideInlineHeader = false,
  startCentered = false,
}: {
  title: string
  placement: PreviewPlacement
  onPlacementChange: (placement: PreviewPlacement) => void
  onClose?: () => void
  actions?: ReactNode
  children: ReactNode
  inlineClassName?: string
  returnLabel?: string
  hideInlineHeader?: boolean
  startCentered?: boolean
}) {
  const [frame, setFrame] = useState<Frame>(() => initialFrame(startCentered))
  useLayoutEffect(() => setFrame(initialFrame(startCentered)), [startCentered])
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; y: number; frame: Frame } | null>(null)
  useEffect(() => {
    const resized = () => setFrame((value) => bounds(value))
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  const floating = placement === 'floating'
  return (
    <section
      aria-label={hideInlineHeader && placement === 'inline' ? undefined : `${title} preview`}
      data-preview-dragging={dragging ? true : undefined}
      data-preview-overlay={placement !== 'inline' ? true : undefined}
      className={cn(
        'flex min-h-0 min-w-0 flex-col bg-background',
        placement === 'inline'
          ? inlineClassName
          : placement === 'expanded'
            ? 'studio-preview-expanded fixed inset-2 z-50 rounded-xl border shadow-2xl'
            : 'fixed z-40 rounded-xl border shadow-2xl',
      )}
      style={
        floating
          ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height }
          : undefined
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape' && placement !== 'inline') {
          event.stopPropagation()
          onPlacementChange('inline')
        }
      }}
    >
      <header
        className={
          hideInlineHeader && placement === 'inline'
            ? 'hidden'
            : 'flex h-10 shrink-0 items-center gap-1 rounded-t-[inherit] border-b px-2'
        }
      >
        {floating && (
          <button
            type="button"
            aria-label={`Move ${title} preview`}
            title="Drag to move; use arrow keys when focused"
            className="flex size-7 shrink-0 cursor-move touch-none items-center justify-center rounded hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              gesture.current = { x: event.clientX, y: event.clientY, frame }
              setDragging(true)
            }}
            onPointerMove={(event) => {
              const start = gesture.current
              if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
              setFrame(
                bounds({
                  ...start.frame,
                  x: start.frame.x + event.clientX - start.x,
                  y: start.frame.y + event.clientY - start.y,
                }),
              )
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onLostPointerCapture={() => {
              gesture.current = null
              setDragging(false)
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 50 : 10
              const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
              const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
              if (!dx && !dy) return
              event.preventDefault()
              setFrame((value) => bounds({ ...value, x: value.x + dx, y: value.y + dy }))
            }}
          >
            <Grip size={14} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={title}>
          {title}
        </span>
        {actions}
        <IconButton
          label={placement === 'floating' ? returnLabel : 'Float preview'}
          className="size-7 shrink-0"
          onClick={() => onPlacementChange(floating ? 'inline' : 'floating')}
        >
          {floating ? <PanelRight size={14} /> : <PictureInPicture2 size={14} />}
        </IconButton>
        <IconButton
          label={placement === 'expanded' ? returnLabel : 'Expand preview'}
          className="size-7 shrink-0"
          onClick={() => onPlacementChange(placement === 'expanded' ? 'inline' : 'expanded')}
        >
          {placement === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        {onClose && (
          <IconButton label="Close preview" className="size-7 shrink-0" onClick={onClose}>
            <X size={14} />
          </IconButton>
        )}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
        {children}
        {dragging && <div className="absolute inset-0 z-50" aria-hidden />}
      </div>
      {floating && (
        <button
          type="button"
          aria-label={`Resize ${title} preview`}
          title="Drag to resize; use arrow keys when focused"
          className="absolute bottom-0 right-0 z-50 flex size-5 cursor-nwse-resize touch-none items-center justify-center rounded-br-xl bg-background/80 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            gesture.current = { x: event.clientX, y: event.clientY, frame }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const start = gesture.current
            if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            setFrame(
              bounds({
                ...start.frame,
                width: Math.min(
                  window.innerWidth - start.frame.x - 8,
                  start.frame.width + event.clientX - start.x,
                ),
                height: Math.min(
                  window.innerHeight - start.frame.y - 8,
                  start.frame.height + event.clientY - start.y,
                ),
              }),
            )
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onLostPointerCapture={() => {
            gesture.current = null
            setDragging(false)
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 50 : 10
            const dw = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
            const dh = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
            if (!dw && !dh) return
            event.preventDefault()
            setFrame((value) =>
              bounds({ ...value, width: value.width + dw, height: value.height + dh }),
            )
          }}
        >
          <span aria-hidden>◢</span>
        </button>
      )}
    </section>
  )
}
