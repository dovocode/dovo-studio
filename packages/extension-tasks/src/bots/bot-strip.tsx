import { useAppPreferences } from '@dovo/studio-core'
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
  const { botLayout, botsInThreads } = useAppPreferences()
  const rows = botLayout === 'rows'
  const tileClass = rows
    ? 'group flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'
    : `group flex ${botLayout === 'horizontal' ? 'w-[72px] shrink-0' : 'w-full min-w-0'} flex-col items-center gap-2 rounded-xl px-1 py-2 text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring`
  const [creating, setCreating] = useState(false)
  if (botsInThreads === false) return null
  return (
    <section aria-label="Bots" className="mb-2 shrink-0 border-b border-border/50 pb-2">
      <div
        data-bot-layout={botLayout}
        className={`px-1 py-1.5 ${botLayout === 'horizontal' ? 'flex gap-1 overflow-x-auto' : botLayout === 'rows' ? 'flex flex-col gap-1' : `grid gap-1 ${botLayout === 'grid-2' ? 'grid-cols-2' : botLayout === 'grid-4' ? 'grid-cols-4' : 'grid-cols-3'}`}`}
      >
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
                    className={tileClass}
                  >
                    <span className="relative rounded-full ring-1 ring-border/60 ring-offset-2 ring-offset-background">
                      {entry.task.pinned && (
                        <span
                          aria-label="Pinned Bot"
                          className="absolute -bottom-1 -left-1 z-10 rounded-full border border-border/60 bg-background p-0.5 text-muted-foreground"
                        >
                          <Pin size={10} />
                        </span>
                      )}
                      <BotAvatar
                        avatar={entry.task.bot?.avatar}
                        name={entry.task.title}
                        className={`rounded-full border-0 ${rows ? 'size-9 [&>svg]:size-5' : ''}`}
                      />
                      {unread && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-primary"
                        />
                      )}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate ${rows ? 'text-left' : 'w-full text-center'} leading-4 ${unread ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
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
          className={tileClass}
        >
          <span
            className={`flex ${rows ? 'size-9' : 'size-12'} shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors group-hover:border-primary/60 group-hover:text-primary`}
          >
            <Plus size={20} />
          </span>
          {!!entries.length && <span className="leading-4 text-muted-foreground">New Bot</span>}
        </button>
      </div>
      {creating && <BotCreateDialog onClose={() => setCreating(false)} />}
    </section>
  )
}
