import type { ReactNode } from 'react'
import { type RuntimeOverview, type TerminalInfo } from '@dovo/protocol'
import { ContextMenu } from '@dovo/studio-ui'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { ArrowUpRight, Columns2, Copy, Folder, Pencil, Plus, Rows2, X } from 'lucide-react'
import { TerminalRename } from './terminal-rename'
import type { TerminalPaneCommand } from './terminal-pane'

export type TerminalContextActions = {
  owner: Pick<RuntimeOverview, 'profile' | 'connected' | 'snapshot'>
  session: TerminalInfo
  onError: (message: string) => void
  onNew: () => void
  onCommand: (action: TerminalPaneCommand['action']) => void
}
const itemClass =
  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-3.5 [&>svg]:shrink-0'

/** Session commands shared by Unified and the Terminals sidebar. Text actions stay in the PTY. */
export function TerminalContextMenu({
  owner,
  session,
  onError,
  onNew,
  onCommand,
  onOpen,
  selected,
  disabled,
  lifecycle,
  children,
}: TerminalContextActions & {
  onOpen: () => void
  selected: boolean
  disabled: boolean
  lifecycle: ReactNode
  children: ReactNode
}) {
  const blocked = disabled || !owner.connected
  const copy = (text: string) =>
    void copyTextToClipboard(text).catch((cause: unknown) => onError(String(cause)))
  const directory = session.directory
  return (
    <TerminalRename owner={owner} session={session} onError={onError}>
      {(rename) => (
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              className="studio-menu-surface studio-row-menu z-50 min-w-56 rounded-2xl border bg-[var(--studio-floating-fill)] p-1 text-popover-foreground"
              collisionPadding={8}
            >
              <ContextMenu.Label className="max-w-64 truncate px-2.5 py-1.5 text-xs text-muted-foreground">
                {session.title}
              </ContextMenu.Label>
              {!selected && (
                <ContextMenu.Item className={itemClass} disabled={disabled} onSelect={onOpen}>
                  <ArrowUpRight />
                  Open
                </ContextMenu.Item>
              )}
              <ContextMenu.Item className={itemClass} disabled={blocked} onSelect={rename}>
                <Pencil />
                Rename…
              </ContextMenu.Item>
              {lifecycle}
              <ContextMenu.Separator className="my-1 h-px bg-border/70" />
              <ContextMenu.Item
                className={itemClass}
                disabled={blocked || session.exited}
                onSelect={() => onCommand('split-columns')}
              >
                <Columns2 />
                Split left/right
              </ContextMenu.Item>
              <ContextMenu.Item
                className={itemClass}
                disabled={blocked || session.exited}
                onSelect={() => onCommand('split-rows')}
              >
                <Rows2 />
                Split top/bottom
              </ContextMenu.Item>
              <ContextMenu.Item className={itemClass} onSelect={onNew}>
                <Plus />
                New terminal
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border/70" />
              {directory && (
                <ContextMenu.Item className={itemClass} onSelect={() => copy(directory)}>
                  <Folder />
                  Copy working directory
                </ContextMenu.Item>
              )}
              <ContextMenu.Item className={itemClass} onSelect={() => copy(session.id)}>
                <Copy /> Copy terminal ID
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border/70" />
              <ContextMenu.Item
                className={`${itemClass} text-destructive`}
                disabled={blocked}
                onSelect={() => onCommand('close')}
              >
                <X />
                Close terminal…
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      )}
    </TerminalRename>
  )
}
