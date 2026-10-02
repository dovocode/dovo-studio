import { useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { defaultAppPreferences, readAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { cn } from '@dovo/studio-ui'
type WidthPreference = 'threadSidebarWidth' | 'toolsSidebarWidth' | 'viewerSidebarWidth'
export function ResizableSidebar({
  preference,
  side,
  label,
  maxFraction,
  maxWidth,
  reservedWidth = 0,
  resizable = true,
  as: Element = 'aside',
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'aside'> & {
  preference: WidthPreference
  side: 'left' | 'right'
  label: string
  maxFraction: number
  maxWidth: number
  reservedWidth?: number
  resizable?: boolean
  as?: 'aside' | 'div'
}) {
  const id = useId()
  const element = useRef<HTMLElement>(null)
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null)
  const [width, setWidth, currentWidth] = useApplicationState(
    () => readAppPreferences()[preference],
  )
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  useLayoutEffect(() => {
    const parent = element.current?.parentElement
    if (!parent) return
    const measure = () => setContainerWidth(parent.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  const maximum = Math.max(
    0,
    Math.min(
      maxWidth,
      containerWidth === null ? maxWidth : containerWidth * maxFraction - reservedWidth,
    ),
  )
  const minimum = Math.min(180, maximum)
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value))
  const visibleWidth = clamp(width)
  const save = () => updateAppPreferences({ [preference]: currentWidth.current })
  return (
    <Element
      {...props}
      id={id}
      ref={(node) => {
        element.current = node
      }}
      className={cn('relative min-w-0', resizable && 'shrink-0', className)}
      style={{
        ...props.style,
        ...(resizable
          ? {
              width: visibleWidth,
              maxWidth: `min(${maxWidth}px, calc(${maxFraction * 100}% - ${reservedWidth}px))`,
            }
          : {}),
      }}
    >
      {children}
      {resizable && (
        <div
          role="separator"
          aria-label={`Resize ${label}`}
          aria-controls={id}
          aria-orientation="vertical"
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={visibleWidth}
          tabIndex={0}
          title="Drag to resize; double-click to reset"
          className={cn(
            'absolute inset-y-0 z-40 w-2 cursor-col-resize touch-none select-none outline-none [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-primary/60 focus-visible:after:bg-primary',
            side === 'left' ? '-right-1' : '-left-1',
          )}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              width: element.current?.getBoundingClientRect().width ?? visibleWidth,
            }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointer !== event.pointerId) return
            const delta = (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1)
            setWidth(Math.max(180, clamp(drag.current.width + delta)))
          }}
          onLostPointerCapture={() => {
            if (!drag.current) return
            drag.current = null
            setDragging(false)
            save()
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onDoubleClick={() => {
            setWidth(defaultAppPreferences[preference])
            save()
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 50 : 10
            const next =
              event.key === 'Home'
                ? minimum
                : event.key === 'End'
                  ? maximum
                  : event.key === 'ArrowLeft'
                    ? visibleWidth + (side === 'left' ? -step : step)
                    : event.key === 'ArrowRight'
                      ? visibleWidth + (side === 'left' ? step : -step)
                      : null
            if (next === null) return
            event.preventDefault()
            setWidth(Math.max(180, clamp(next)))
            save()
          }}
        />
      )}
      {dragging && <div className="fixed inset-0 z-30 cursor-col-resize select-none" aria-hidden />}
    </Element>
  )
}
