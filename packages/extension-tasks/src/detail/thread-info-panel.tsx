import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '@dovo/studio-ui'
import { X } from 'lucide-react'
import { ThreadInfoCustomization } from './thread-info-customization'
import { ThreadInfoContext, useThreadInfoContext } from './thread-info-context'

export function TaskProjectPanelRoot({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const panelId = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // A stable portal target retains the composer's unsaved settings when Info closes.
    const target = document.createElement('div')
    setContainer(target)
    return () => target.remove()
  }, [])
  const changeOpen = (next: boolean) => {
    if (!next && document.getElementById(panelId)?.contains(document.activeElement))
      document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(panelId)}"]`)?.focus()
    onOpenChange(next)
  }
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Nested menus and dialogs own their first Escape.
      if (
        document.querySelector(
          '[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="listbox"][data-state="open"]',
        )
      )
        return
      event.preventDefault()
      changeOpen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  })
  return (
    <ThreadInfoContext.Provider value={{ container, open, panelId, onOpenChange: changeOpen }}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </ThreadInfoContext.Provider>
  )
}

/** Float context inside its conversation without resizing chat or the tools pane. */
export function ThreadInfoPanel({ children, title }: { children: ReactNode; title?: string }) {
  const context = useThreadInfoContext()
  const panel = useRef<HTMLElement>(null)
  const [maxHeight, setMaxHeight] = useState(480)
  const open = context?.open ?? true
  useLayoutEffect(() => {
    const frame = panel.current?.parentElement
    if (!frame || !open) return
    const composer = frame.querySelector<HTMLElement>('.studio-composer')
    const measure = () => {
      const rect = frame.getBoundingClientRect()
      const bottom = Math.min(
        rect.bottom - 16,
        composer ? composer.getBoundingClientRect().top - 12 : Infinity,
      )
      setMaxHeight(Math.max(0, Math.min(480, bottom - rect.top - 16)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    if (composer) observer.observe(composer)
    measure()
    return () => observer.disconnect()
  }, [open])
  return (
    <aside
      ref={panel}
      id={context?.panelId}
      hidden={!open}
      aria-label="Thread info"
      aria-description={title}
      style={{
        top: 16,
        right: 16,
        maxHeight,
        maxWidth: 'calc(100% - 32px)',
      }}
      className="studio-thread-info-panel studio-menu-surface absolute z-30 flex w-96 min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border outline-none"
    >
      <header className="studio-thread-tools-header flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">Thread info</h2>
        <div className="flex shrink-0 items-center gap-1">
          <ThreadInfoCustomization />
          <IconButton
            label="Close thread info"
            className="size-7"
            onClick={() => context?.onOpenChange(false)}
          >
            <X size={14} />
          </IconButton>
        </div>
      </header>
      <div className="studio-thread-info-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </aside>
  )
}

export function ThreadInfoSettingsSlot({ visible }: { visible: boolean }) {
  const settings = useThreadInfoContext()
  const slot = useRef<HTMLDivElement>(null)
  const container = settings?.container
  useLayoutEffect(() => {
    const parent = slot.current
    if (!parent || !container) return
    parent.appendChild(container)
    return () => {
      if (container.parentNode === parent) container.remove()
    }
  }, [container])
  return settings ? <div ref={slot} hidden={!visible} /> : null
}
