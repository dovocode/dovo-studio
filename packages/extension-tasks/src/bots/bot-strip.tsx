import { useState } from 'react'
import { Pin, Plus } from 'lucide-react'
import { compareBotActivity, hasUnreadTaskActivity } from '@dovo/protocol'
import { BotAvatar, ContextMenu } from '@dovo/studio-ui'
import type { TaskEntry } from '../list/task-collection'
import { BotCreateDialog } from './bot-create-dialog'

export function BotStrip({
  entries,
  onOpen,
  onPin,
  busy = false,
}: {
  entries: readonly TaskEntry[]
  onOpen: (entry: TaskEntry) => void
  onPin: (entry: TaskEntry) => void
  busy?: boolean
}) {
  const [creating, setCreating] = useState(false)
  return (
    <section aria-label="Bots" className="mb-3 shrink-0 border-b pb-3">
      <h2 className="px-2 py-1 text-xs font-medium text-muted-foreground">Bots</h2>
      <div className="flex gap-2 overflow-x-auto px-1 py-2">
        {[...entries]
          .sort((a, b) => compareBotActivity(a.task, b.task) || a.key.localeCompare(b.key))
          .map((entry) => {
            const unread = hasUnreadTaskActivity(entry.task)
            return (
              <ContextMenu.Root key={entry.key}>
                <ContextMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={`Open Bot ${entry.task.title} on ${entry.source.name}${unread ? ', new messages' : ''}${entry.source.online ? '' : ', offline'}`}
                    title={`${entry.task.title} · ${entry.source.name}`}
                    onClick={() => onOpen(entry)}
                    className="flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-lg p-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring"
                  >
                    <span className="relative">
                      {entry.task.pinned && (
                        <span
                          aria-label="Pinned Bot"
                          className="absolute -bottom-1 -left-1 z-10 rounded-full bg-background p-0.5"
                        >
                          <Pin size={10} />
                        </span>
                      )}
                      <BotAvatar avatar={entry.task.bot?.avatar} name={entry.task.title} />
                      {unread && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-primary"
                        />
                      )}
                    </span>
                    <span
                      className={`line-clamp-2 w-full text-center${unread ? ' font-semibold' : ''}`}
                    >
                      {entry.task.title}
                    </span>
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 min-w-40 rounded-lg border bg-popover p-1 shadow-lg">
                    <ContextMenu.Item
                      disabled={busy || !entry.source.online}
                      onSelect={() => onPin(entry)}
                      className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
                    >
                      {entry.task.pinned ? 'Unpin Bot' : 'Pin Bot'}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            )
          })}
        <button
          type="button"
          aria-label="New Bot"
          title="New Bot"
          onClick={() => setCreating(true)}
          className="flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-lg p-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl border bg-muted/40 text-primary">
            <Plus size={24} />
          </span>
          {!!entries.length && <span>New Bot</span>}
        </button>
      </div>
      {creating && <BotCreateDialog onClose={() => setCreating(false)} />}
    </section>
  )
}
