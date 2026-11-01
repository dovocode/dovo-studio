import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Popover } from '@dovo/studio-ui'
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
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </Popover.Root>
    </ThreadInfoContext.Provider>
  )
}

/** Anchor the card to the conversation, independently of the header and tools pane. */
export function TaskProjectPopover({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const settings = useThreadInfoContext()
  return (
    <>
      <Popover.Anchor
        ref={setAnchor}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-8 h-px"
      />
      <Popover.Portal forceMount={settings ? true : undefined}>
        <Popover.Content
          forceMount={settings ? true : undefined}
          hidden={settings ? !settings.open : undefined}
          aria-label="Thread info"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          align="end"
          side="bottom"
          sideOffset={-1}
          avoidCollisions={false}
          collisionBoundary={anchor?.parentElement ?? undefined}
          collisionPadding={32}
          className="studio-project-popover studio-menu-surface z-40 overflow-y-auto rounded-2xl border bg-popover text-popover-foreground outline-none"
        >
          <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            <h2 className="text-sm font-semibold">Thread info</h2>
            <ThreadInfoCustomization />
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
