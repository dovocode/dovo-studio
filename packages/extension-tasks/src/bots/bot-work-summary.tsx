import { useState } from 'react'
import { Archive, CalendarClock, Users } from 'lucide-react'
import { botResultSchema, botWorkSummary, taskIsWorking, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'

export function BotWorkSummary(props: {
  task: Task
  onRoutines: () => void
  onWorkers: () => void
}) {
  const { activeRuntimeId, connection } = useWorkspace()
  return (
    <BotWorkControls
      key={JSON.stringify([activeRuntimeId, connection, props.task.id])}
      {...props}
    />
  )
}
function BotWorkControls({
  task,
  onRoutines,
  onWorkers,
}: {
  task: Task
  onRoutines: () => void
  onWorkers: () => void
}) {
  const uiText = useInterfaceText()
  const { workspace, snapshot, connected, request } = useWorkspace()
  const work = botWorkSummary(task, workspace.tasks, workspace.automations, snapshot?.runs ?? [])
  const lastMessageId = task.messages.at(-1)?.id
  const [revision, setRevision] = useState<{ revision: string; lastMessageId: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const routines = uiText('Routines · {value0}{value1}{value2}{value3}', {
    value0: work.routines,
    value1: work.running ? ` · ${work.running} ${uiText('working')}` : '',
    value2: work.review ? ` · ${work.review} ${uiText('need review')}` : '',
    value3: work.failed ? ` · ${work.failed} ${uiText('failed')}` : '',
  })
  return (
    <section
      aria-label={uiText('Bot work overview')}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
    >
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        aria-label={routines}
        onClick={onRoutines}
      >
        <CalendarClock className="size-3.5 text-muted-foreground" />
        {uiText('Routines')}{' '}
        <span className="rounded-full bg-muted px-1.5 tabular-nums">{work.routines}</span>
        {!!(work.review || work.failed || work.running) && (
          <span className={work.failed ? 'text-destructive' : 'text-muted-foreground'}>
            {work.failed
              ? `${work.failed} ${uiText('failed')}`
              : work.review
                ? `${work.review} ${uiText('need review')}`
                : `${work.running} ${uiText('working')}`}
          </span>
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        aria-label={uiText('Workers · {value0} active{value1}', {
          value0: work.workers,
          value1: work.offlineWorkers ? ` · ${work.offlineWorkers} ${uiText('offline')}` : '',
        })}
        onClick={onWorkers}
      >
        <Users className="size-3.5 text-muted-foreground" />
        {uiText('Workers')}
        <span className="rounded-full bg-muted px-1.5 tabular-nums">{work.workers}</span>
        {!!work.offlineWorkers && (
          <span className="text-muted-foreground">
            {work.offlineWorkers} {uiText('offline')}
          </span>
        )}
      </Button>
      {!connected && <span className="text-muted-foreground">{uiText('Last saved state')}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={
          !connected ||
          !snapshot?.botConversationArchiveSupported ||
          !lastMessageId ||
          taskIsWorking(task) ||
          busy
        }
        onClick={() => {
          setError('')
          if (task.bot && lastMessageId) setRevision({ revision: task.bot.revision, lastMessageId })
        }}
      >
        <Archive className="size-3.5" />
        {uiText('Archive and start new')}
      </Button>
      <Dialog
        open={!!revision}
        onOpenChange={(open) => {
          if (!open && !busy) setRevision(undefined)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>{uiText('Archive and start new?')}</DialogTitle>
          <DialogDescription>
            {uiText(
              'Save this conversation under the same Bot and start a fresh conversation. Settings, memory, routines and your unsent draft stay.',
            )}
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setRevision(undefined)}>
              {uiText('Cancel')}
            </Button>
            <Button
              disabled={busy || !connected}
              onClick={() => {
                if (!revision || busy) return
                setBusy(true)
                setError('')
                void request(
                  '/api/bots/archive-conversation',
                  {
                    id: task.id,
                    expectedRevision: revision.revision,
                    expectedLastMessageId: revision.lastMessageId,
                  },
                  botResultSchema,
                )
                  .then(() => setRevision(undefined))
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => setBusy(false))
              }}
            >
              {uiText(busy ? 'Saving…' : 'Archive and start new')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
