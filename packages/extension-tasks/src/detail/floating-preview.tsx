import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Grip, Maximize2, Minimize2, PanelRight, PictureInPicture2, X } from 'lucide-react'
import { cn, IconButton } from '@dovo/studio-ui'

export type PreviewPlacement = 'inline' | 'floating' | 'expanded'
type Frame = { x: number; y: number; width: number; height: number }
type Viewport = { width: number; height: number; top: number }
const windowViewport = (): Viewport => ({
  width: window.innerWidth,
  height: window.innerHeight,
  top:
    8 +
    (parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--studio-window-top-inset'),
    ) || 0),
})
const bounds = (frame: Frame, viewport: Viewport): Frame => {
  const { width: availableWidth, height: availableHeight, top } = viewport
  const width = Math.min(Math.max(280, frame.width), Math.max(0, availableWidth - 16))
  const height = Math.min(Math.max(220, frame.height), Math.max(0, availableHeight - top - 8))
  return {
    width,
    height,
    x: Math.max(8, Math.min(availableWidth - width - 8, frame.x)),
    y: Math.max(top, Math.min(availableHeight - height - 8, frame.y)),
  }
}
const initialFrame = (centered: boolean, viewport?: Viewport): Frame => {
  if (typeof window === 'undefined') return { x: 8, y: 8, width: 460, height: 380 }
  viewport ??= windowViewport()
  const width = Math.min(1120, viewport.width * 0.85)
  const height = Math.min(800, (viewport.height - viewport.top + 8) * 0.85)
  return bounds(
    centered
      ? {
          x: (viewport.width - width) / 2,
          y: (viewport.height + viewport.top - 8 - height) / 2,
          width,
          height,
        }
      : { x: viewport.width - 480, y: viewport.height - 420, width: 460, height: 380 },
    viewport,
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
  contained = false,
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
  contained?: boolean
}) {
  const section = useRef<HTMLElement>(null)
  const customized = useRef(false)
  const viewport = useCallback((): Viewport => {
    const parent = contained ? section.current?.parentElement : null
    return parent
      ? { width: parent.clientWidth, height: parent.clientHeight, top: 8 }
      : windowViewport()
  }, [contained])
  const constrain = (value: Frame) => bounds(value, viewport())
  const [frame, setFrame] = useState<Frame>(() => initialFrame(startCentered))
  useLayoutEffect(() => {
    customized.current = false
    setFrame(initialFrame(startCentered, viewport()))
    const resized = () =>
      setFrame((value) =>
        startCentered && !customized.current
          ? initialFrame(true, viewport())
          : bounds(value, viewport()),
      )
    const parent = contained ? section.current?.parentElement : null
    const observer = parent ? new ResizeObserver(resized) : null
    if (parent) observer?.observe(parent)
    window.addEventListener('resize', resized)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resized)
    }
  }, [startCentered, contained, viewport])
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; y: number; frame: Frame } | null>(null)
  const floating = placement === 'floating'
  return (
    <section
      ref={section}
      aria-label={hideInlineHeader && placement === 'inline' ? undefined : `${title} preview`}
      data-preview-dragging={dragging ? true : undefined}
      data-preview-overlay={placement !== 'inline' ? true : undefined}
      className={cn(
        'flex min-h-0 min-w-0 flex-col bg-background',
        placement === 'inline'
          ? inlineClassName
          : placement === 'expanded'
            ? cn(
                contained ? 'absolute inset-2' : 'studio-preview-expanded fixed inset-2',
                'z-50 rounded-xl border shadow-2xl',
              )
            : cn(contained ? 'absolute' : 'fixed', 'z-40 rounded-xl border shadow-2xl'),
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
              customized.current = true
              gesture.current = { x: event.clientX, y: event.clientY, frame }
              setDragging(true)
            }}
            onPointerMove={(event) => {
              const start = gesture.current
              if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
              setFrame(
                constrain({
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
              customized.current = true
              setFrame((value) => constrain({ ...value, x: value.x + dx, y: value.y + dy }))
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
            customized.current = true
            gesture.current = { x: event.clientX, y: event.clientY, frame }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const start = gesture.current
            if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            setFrame(
              constrain({
                ...start.frame,
                width: Math.min(
                  viewport().width - start.frame.x - 8,
                  start.frame.width + event.clientX - start.x,
                ),
                height: Math.min(
                  viewport().height - start.frame.y - 8,
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
            customized.current = true
            setFrame((value) =>
              constrain({ ...value, width: value.width + dw, height: value.height + dh }),
            )
          }}
        >
          <span aria-hidden>◢</span>
        </button>
      )}
    </section>
  )
}
