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

/** Float thread context over chat without changing the conversation layout. */
export function TaskProjectPopover({ children, title }: { children: ReactNode; title?: string }) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number>()
  const [maxWidth, setMaxWidth] = useState<number>()
  const settings = useThreadInfoContext()
  useLayoutEffect(() => {
    const frame = anchor?.parentElement
    if (!frame || !settings?.open) return
    const composer = frame.querySelector<HTMLElement>('.studio-composer')
    const measure = () => {
      const top = anchor.getBoundingClientRect().top
      const bottom = Math.min(
        frame.getBoundingClientRect().bottom - 32,
        composer ? composer.getBoundingClientRect().top - 12 : Infinity,
      )
      setMaxHeight(Math.max(0, Math.min(480, bottom - top)))
      setMaxWidth(Math.max(0, frame.getBoundingClientRect().width - 64))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    if (composer) observer.observe(composer)
    measure()
    return () => {
      observer.disconnect()
    }
  }, [anchor, settings?.open])
  return (
    <>
      <Popover.Anchor
        ref={setAnchor}
        aria-hidden="true"
        className="studio-thread-info-anchor pointer-events-none absolute inset-x-8 top-8 h-px"
      />
      <Popover.Portal forceMount={settings ? true : undefined}>
        <Popover.Content
          forceMount={settings ? true : undefined}
          hidden={settings ? !settings.open : undefined}
          aria-label="Thread info"
          aria-description={title}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          align="end"
          side="bottom"
          sideOffset={-1}
          avoidCollisions={false}
          collisionBoundary={anchor?.parentElement ?? undefined}
          collisionPadding={32}
          style={{ maxHeight, maxWidth }}
          className="studio-project-popover studio-menu-surface z-40 flex flex-col overflow-hidden rounded-2xl border bg-[var(--studio-floating-fill)] text-popover-foreground outline-none"
        >
          <header className="z-10 flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-popover px-3">
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
          <div className="studio-thread-info-scroll min-h-0 overflow-y-auto overscroll-contain">
            {children}
          </div>
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
