import { CalendarPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  randomUUID,
  routineSuggestionFields,
  routineSuggestionNextRun,
  routineSuggestionResultSchema,
  routineSuggestionWords,
  type ChatMessage,
  type RoutineSuggestionFields,
} from '@dovo/protocol'
import { clientScopeKey, useStudioHost, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  MessageAction,
  Textarea,
} from '@dovo/studio-ui'

export function SuggestRoutine({ taskId, message }: { taskId: string; message: ChatMessage }) {
  const { activeRuntimeId, connected, connection, request, snapshot, workspace } = useWorkspace()
  const host = useStudioHost()
  const [draft, setDraft] = useState<RoutineSuggestionFields>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useRef<string | undefined>(undefined)
  const scope = JSON.stringify([clientScopeKey(connection), activeRuntimeId, taskId, message.id])
  const active = useRef('')
  useEffect(() => {
    active.current = scope
    id.current = undefined
    setDraft(undefined)
    setError('')
    setBusy(false)
    return () => {
      active.current = ''
    }
  }, [scope])
  const bot = workspace.tasks.find((task) => task.id === taskId)?.bot
  if (message.role !== 'user' || !bot || !snapshot?.routineSuggestionsSupported) return null
  const words = routineSuggestionWords(message)
  if (!words) return null
  const enabled = bot.state !== 'paused'
  const next = draft && routineSuggestionNextRun(draft)
  const edit = (key: keyof RoutineSuggestionFields, value: string) =>
    setDraft((current) => current && { ...current, [key]: value })
  const save = async () => {
    if (!draft || busy || !connected || !enabled || !next) return
    setError('')
    setBusy(true)
    const routeCurrent = host.taskNavigationGuard?.()
    try {
      const result = await request(
        '/api/jobs/from-message',
        {
          id: (id.current ??= randomUUID()),
          taskId,
          messageId: message.id,
          draft,
        },
        routineSuggestionResultSchema,
      )
      if (active.current !== scope) return
      setDraft(undefined)
      if (!routeCurrent || routeCurrent())
        host.navigate({
          viewId: 'jobs',
          entityId: result.id,
          ...(activeRuntimeId
            ? { automationTarget: { runtimeId: activeRuntimeId, automationId: result.id } }
            : {}),
        })
    } catch (cause) {
      if (active.current === scope) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (active.current === scope) setBusy(false)
    }
  }
  return (
    <>
      <MessageAction
        label="Suggest a routine"
        disabled={!enabled}
        className="size-6 text-muted-foreground"
        onClick={() => {
          id.current = undefined
          setError('')
          setDraft(
            routineSuggestionFields(
              words,
              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            ),
          )
        }}
      >
        <CalendarPlus size={12} />
      </MessageAction>
      {draft && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDraft(undefined)
          }}
        >
          <DialogContent>
            <DialogTitle>Suggest a routine</DialogTitle>
            <DialogDescription>
              Review the instructions and schedule for this Bot. Saving keeps the triggers paused.
            </DialogDescription>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <fieldset disabled={busy} className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  Name
                  <Input
                    maxLength={200}
                    value={draft.name}
                    onChange={(e) => edit('name', e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Instructions
                  <Textarea
                    maxLength={16000}
                    value={draft.objective}
                    onChange={(e) => edit('objective', e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Schedule (cron)
                  <Input
                    maxLength={160}
                    placeholder="0 9 * * 5"
                    value={draft.schedule}
                    onChange={(e) => edit('schedule', e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Time zone
                  <Input
                    maxLength={100}
                    value={draft.timezone}
                    onChange={(e) => edit('timezone', e.target.value)}
                  />
                </label>
              </fieldset>
              <p className="text-sm text-muted-foreground" role="status">
                {next
                  ? `Next scheduled time · ${next.toLocaleString(undefined, { timeZone: draft.timezone.trim(), timeZoneName: 'short' })}`
                  : 'Enter a schedule and time zone.'}
              </p>
              {!connected && <p role="status">Reconnect to save this routine.</p>}
              {error && <p role="alert">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDraft(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !connected ||
                    !enabled ||
                    !draft.name.trim() ||
                    !draft.objective.trim() ||
                    !next
                  }
                >
                  Save paused routine
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
