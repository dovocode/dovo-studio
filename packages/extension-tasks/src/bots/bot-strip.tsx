import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useAppPreferences } from '@dovo/studio-core'
import { useState } from 'react'
import { CircleAlert, Pin, Plus } from 'lucide-react'
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
  const uiText = useInterfaceText()

  const { botLayout, botsInThreads } = useAppPreferences()
  const rows = botLayout === 'rows'
  const tileClass = rows
    ? 'group flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'
    : `group flex ${botLayout === 'horizontal' ? 'w-[72px] shrink-0' : 'w-full min-w-0'} flex-col items-center gap-2 rounded-xl px-1 py-2 text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring`
  const [creating, setCreating] = useState(false)
  if (botsInThreads === false) return null
  return (
    <section aria-label={uiText('Bots')} className="mb-2 shrink-0 border-b border-border/50 pb-2">
      <div
        data-bot-layout={botLayout}
        className={`px-1 py-1.5 ${botLayout === 'horizontal' ? 'flex gap-1 overflow-x-auto' : botLayout === 'rows' ? 'flex flex-col gap-1' : `grid gap-1 ${botLayout === 'grid-2' ? 'grid-cols-2' : botLayout === 'grid-4' ? 'grid-cols-4' : 'grid-cols-3'}`}`}
      >
        {[...entries]
          .sort((a, b) => compareBotActivity(a.task, b.task) || a.key.localeCompare(b.key))
          .map((entry) => {
            const unread = hasUnreadTaskActivity(entry.task)
            const attention = entry.needsInput
              ? 'Needs input'
              : entry.task.status === 'failed'
                ? 'Failed'
                : undefined
            const attentionColor = entry.needsInput ? 'text-status-warning' : 'text-status-error'
            return (
              <ContextMenu.Root key={entry.key}>
                <ContextMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={`${uiText('Open Bot {value0} on {value1}{value2}{value3}{value4}', {
                      value0: entry.task.title,
                      value1: entry.source.name,
                      value2: unread ? ', new messages' : '',
                      value3: '',
                      value4: entry.source.online ? '' : ', offline',
                    })}${attention ? ` · ${uiText(attention)}` : ''}`}
                    title={`${entry.task.title} · ${entry.source.name}${attention ? ` · ${uiText(attention)}` : ''}`}
                    onClick={() => onOpen(entry)}
                    data-bot-attention={attention}
                    className={`${tileClass} ${attention ? (entry.needsInput ? 'bg-status-warning/10' : 'bg-status-error/10') : ''}`}
                  >
                    <span
                      className={`relative rounded-full ring-offset-2 ring-offset-background ${attention ? (entry.needsInput ? 'ring-2 ring-status-warning' : 'ring-2 ring-status-error') : 'ring-1 ring-border/60'}`}
                    >
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
                      {attention && (
                        <span
                          aria-hidden="true"
                          className={`absolute -right-1.5 -top-1.5 z-10 rounded-full border-2 border-background bg-background ${attentionColor}`}
                        >
                          <CircleAlert size={15} />
                        </span>
                      )}
                      {unread && (
                        <span
                          aria-hidden="true"
                          data-bot-unread="true"
                          className={`absolute -right-1 ${attention ? '-bottom-1' : '-top-1'} size-3 rounded-full border-2 border-background bg-primary`}
                        />
                      )}
                    </span>
                    <span className={`min-w-0 ${rows ? 'flex-1 text-left' : 'w-full text-center'}`}>
                      <span
                        className={`block truncate leading-4 ${attention || unread ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
                      >
                        {entry.task.title}
                      </span>
                      {attention && (
                        <span
                          className={`mt-0.5 block text-[11px] font-medium leading-4 ${attentionColor}`}
                        >
                          {uiText(attention)}
                        </span>
                      )}
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
          aria-label={uiText('New Bot')}
          title={uiText('New Bot')}
          onClick={() => setCreating(true)}
          className={tileClass}
        >
          <span
            className={`flex ${rows ? 'size-9' : 'size-12'} shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors group-hover:border-primary/60 group-hover:text-primary`}
          >
            <Plus size={20} />
          </span>
          {!!entries.length && (
            <span className="leading-4 text-muted-foreground">{uiText('New Bot')}</span>
          )}
        </button>
      </div>
      {creating && <BotCreateDialog onClose={() => setCreating(false)} />}
    </section>
  )
}
