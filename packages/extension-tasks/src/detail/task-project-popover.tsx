import { useState, type ReactNode } from 'react'
import { Popover } from '@dovo/studio-ui'

export function TaskProjectPanelRoot({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <div className="flex h-full min-h-0 flex-col">{children}</div>
    </Popover.Root>
  )
}

/** Anchor the card to the conversation, independently of the header and tools pane. */
export function TaskProjectPopover({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <Popover.Anchor
        ref={setAnchor}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-8 h-px"
      />
      <Popover.Portal>
        <Popover.Content
          aria-label="Project information"
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
          className="studio-project-popover z-40 overflow-y-auto rounded-2xl border bg-popover text-popover-foreground shadow-xl outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </>
  )
}
