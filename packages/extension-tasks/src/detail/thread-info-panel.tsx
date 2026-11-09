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

/** Thread context lives inside the same docked pane as Files and Changes. */
export function ThreadInfoPanel({ children, title }: { children: ReactNode; title?: string }) {
  const context = useThreadInfoContext()
  return (
    <aside
      id={context?.panelId}
      hidden={context ? !context.open : undefined}
      aria-label="Thread info"
      aria-description={title}
      className="studio-thread-info-panel flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
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
