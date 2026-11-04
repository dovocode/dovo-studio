import { useEffect, useRef, useState } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from './components/ui/button'
import { cn } from './lib/utils'

/** A bounded image canvas: fit, actual pixels, cursor-centred zoom and pointer panning. */
export function ImageViewer({
  src,
  alt,
  className,
  onError,
}: {
  src: string
  alt: string
  className?: string
  onError?: () => void
}) {
  // A new source gets its own dimensions, fit and gesture state.
  return <ImageCanvas key={src} src={src} alt={alt} className={className} onError={onError} />
}
function ImageCanvas({ src, alt, className, onError }: Parameters<typeof ImageViewer>[0]) {
  const canvas = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [view, setViewState] = useState<{ scale: number | null; x: number; y: number }>({
    scale: null,
    x: 0,
    y: 0,
  })
  const currentView = useRef(view)
  const setView = (next: typeof view) => {
    currentView.current = next
    setViewState(next)
  }
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const resize = new ResizeObserver(() =>
      setArea({ width: element.clientWidth, height: element.clientHeight }),
    )
    resize.observe(element)
    return () => resize.disconnect()
  }, [])
  const ready = natural.width > 0 && area.width > 0 && area.height > 0
  const fit = ready ? Math.min(area.width / natural.width, area.height / natural.height, 1) : 1
  const scale = view.scale ?? fit
  const minimum = Math.min(fit, 0.1)
  const clamp = (x: number, y: number, nextScale = scale) => {
    const maxX = Math.max(0, (natural.width * nextScale - area.width) / 2)
    const maxY = Math.max(0, (natural.height * nextScale - area.height) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }
  const offset = clamp(view.x, view.y)
  const zoom = (next: number, point?: { x: number; y: number }, movement = { x: 0, y: 0 }) => {
    const current = currentView.current
    const currentScale = current.scale ?? fit
    const currentOffset = clamp(current.x, current.y, currentScale)
    const nextScale = Math.max(minimum, Math.min(8, next))
    const bounds = canvas.current?.getBoundingClientRect()
    const x = point && bounds ? point.x - bounds.left - area.width / 2 : 0
    const y = point && bounds ? point.y - bounds.top - area.height / 2 : 0
    setView({
      scale: nextScale,
      ...clamp(
        x - (x - currentOffset.x) * (nextScale / currentScale) + movement.x,
        y - (y - currentOffset.y) * (nextScale / currentScale) + movement.y,
        nextScale,
      ),
    })
  }
  const reset = () => setView({ scale: null, x: 0, y: 0 })
  // React's wheel listeners are passive; prevent the surrounding page from scrolling/zooming.
  useEffect(() => {
    const element = canvas.current
    if (!element || !ready) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.height : 1)
      zoom(
        (currentView.current.scale ?? fit) *
          Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.005),
        {
          x: event.clientX,
          y: event.clientY,
        },
      )
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  })
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      <div
        role="toolbar"
        aria-label="Image controls"
        className="flex shrink-0 items-center justify-center gap-1 p-1"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          disabled={!ready || scale <= minimum}
          onClick={() => zoom(scale / 1.25)}
        >
          <ZoomOut className="size-4" />
        </Button>
        <output aria-label="Image zoom" className="w-14 text-center text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          disabled={!ready || scale >= 8}
          onClick={() => zoom(scale * 1.25)}
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!ready}
          aria-pressed={view.scale === 1}
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
        >
          Actual size
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!ready}
          aria-pressed={view.scale === null}
          onClick={reset}
        >
          <Maximize className="size-4" /> Fit
        </Button>
      </div>
      <div
        ref={canvas}
        role="region"
        aria-label={`Image viewer: ${alt}`}
        aria-description="Scroll or pinch to zoom. Drag to pan. Use + and − to zoom, arrow keys to pan, and 0 to fit."
        tabIndex={0}
        className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-md bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onDoubleClick={() => {
          if (ready) {
            if (view.scale === null) zoom(1)
            else reset()
          }
        }}
        onKeyDown={(event) => {
          if (!ready || event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === '+' || event.key === '=') zoom(scale * 1.25)
          else if (event.key === '-') zoom(scale / 1.25)
          else if (event.key === '0') reset()
          else if (event.key.startsWith('Arrow')) {
            const x = event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0
            const y = event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0
            setView({ scale, ...clamp(offset.x + x, offset.y + y) })
          } else return
          event.preventDefault()
        }}
        onPointerDown={(event) => {
          if (!ready || event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId)
          if (!previous) return
          const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1]
          const current = { x: event.clientX, y: event.clientY }
          pointers.current.set(event.pointerId, current)
          if (other) {
            const before = Math.hypot(previous.x - other.x, previous.y - other.y)
            const after = Math.hypot(current.x - other.x, current.y - other.y)
            if (before > 0)
              zoom(
                ((currentView.current.scale ?? fit) * after) / before,
                { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 },
                { x: (current.x - previous.x) / 2, y: (current.y - previous.y) / 2 },
              )
          } else {
            const latest = currentView.current
            const currentScale = latest.scale ?? fit
            const offset = clamp(latest.x, latest.y, currentScale)
            setView({
              scale: currentScale,
              ...clamp(
                offset.x + current.x - previous.x,
                offset.y + current.y - previous.y,
                currentScale,
              ),
            })
          }
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId)
          setDragging(pointers.current.size > 0)
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          referrerPolicy="no-referrer"
          onError={onError}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            left: '50%',
            top: '50%',
            width: natural.width || undefined,
            height: natural.height || undefined,
            visibility: ready ? undefined : 'hidden',
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        />
      </div>
    </div>
  )
}
