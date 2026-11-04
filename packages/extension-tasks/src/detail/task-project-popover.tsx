import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Popover, IconButton } from '@dovo/studio-ui'
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
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Keep one portal target for the lifetime of the thread. Closing or reordering Info
    // detaches the target, preserving unsaved settings and native control state.
    const target = document.createElement('div')
    setContainer(target)
    return () => target.remove()
  }, [])
  return (
    <ThreadInfoContext.Provider value={{ container, open }}>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </Popover.Root>
    </ThreadInfoContext.Provider>
  )
}

/** Reserve a desktop inspector column; compact layouts retain a bounded popover. */
export function TaskProjectPopover({ children, title }: { children: ReactNode; title?: string }) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number>()
  const [docked, setDocked] = useState(false)
  const settings = useThreadInfoContext()
  useLayoutEffect(() => {
    const frame = anchor?.parentElement
    if (!frame || !settings?.open) return
    const composer = frame.querySelector<HTMLElement>('.studio-composer')
    const measure = () => {
      const top = anchor.getBoundingClientRect().top
      const desktop =
        window.matchMedia('(min-width: 1100px)').matches &&
        frame.getBoundingClientRect().width >= 700
      frame.dataset.infoDocked = String(desktop)
      setDocked(desktop)
      const bottom = desktop
        ? frame.getBoundingClientRect().bottom
        : Math.min(
            frame.getBoundingClientRect().bottom - 32,
            composer ? composer.getBoundingClientRect().top - 12 : Infinity,
          )
      setMaxHeight(Math.max(0, bottom - top))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    if (composer) observer.observe(composer)
    measure()
    return () => {
      observer.disconnect()
      delete frame.dataset.infoDocked
    }
  }, [anchor, settings?.open])
  return (
    <>
      <Popover.Anchor
        ref={setAnchor}
        aria-hidden="true"
        data-docked={docked || undefined}
        className="studio-thread-info-anchor pointer-events-none absolute inset-x-8 top-8 h-px"
      />
      <Popover.Portal forceMount={settings ? true : undefined}>
        <Popover.Content
          forceMount={settings ? true : undefined}
          hidden={settings ? !settings.open : undefined}
          aria-label="Thread info"
          aria-description={title}
          data-docked={docked || undefined}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          align="end"
          side="bottom"
          sideOffset={-1}
          avoidCollisions={false}
          collisionBoundary={anchor?.parentElement ?? undefined}
          collisionPadding={32}
          style={{ maxHeight, height: docked ? maxHeight : undefined }}
          className="studio-project-popover studio-menu-surface z-40 overflow-y-auto rounded-2xl border bg-popover text-popover-foreground outline-none"
        >
          <header className="flex h-12 items-center justify-between gap-3 border-b px-5">
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-semibold">Thread info</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ThreadInfoCustomization />
              <Popover.Close asChild>
                <IconButton label="Close thread info" className="size-7">
                  <X size={14} />
                </IconButton>
              </Popover.Close>
            </div>
          </header>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </>
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
