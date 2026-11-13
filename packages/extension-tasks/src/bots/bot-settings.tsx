import { BotAvatarEditor } from './bot-avatar-editor'
import { BotResourceEditor } from './bot-resource-editor'
import { botScope } from './bot-scope'
import { useRef, useState } from 'react'
import {
  botResultSchema,
  workspacePatchResultSchema,
  emptyBotResources,
  taskResources,
  type Bot,
  type BotResources,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, FormField, Input, Textarea } from '@dovo/studio-ui'
import { ComposerHarnessControls } from '../chat/composer/composer-harness-controls'
import { taskActionClient, taskRowPatch } from '../list/task-row-actions'
import { BotMemory } from './bot-memory'
import { BotRoutines } from './bot-routines'

type Draft = {
  name: string
  originalName: string
  originalRole: string
  originalResponsibilities: string
  role: string
  responsibilities: string
  revision: string
}
const drafts = new Map<string, Draft>()

export function BotSettings({
  task,
  section = 'settings',
}: {
  task: Task
  section?: 'settings' | 'mcp' | 'skill' | 'memory' | 'routines'
}) {
  const store = useWorkspace()
  const [ack, setAck] = useState<{ before: string; bot: Bot }>()
  const hostBot = ack && task.bot?.revision === ack.before ? ack.bot : task.bot
  const scope = JSON.stringify([
    botScope(store.snapshot?.runtimeId ?? store.activeRuntimeId, store.connection),
    task.id,
  ])
  const [draft, setDraft] = useState<Draft | undefined>(() => drafts.get(scope))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  if (!hostBot) return null
  const value = draft ?? {
    name: task.title,
    originalName: task.title,
    originalRole: hostBot.role,
    originalResponsibilities: hostBot.responsibilities,
    role: hostBot.role,
    responsibilities: hostBot.responsibilities,
    revision: hostBot.revision,
  }
  const dirty = !!draft
  const supported = store.snapshot?.botsSupported === true
  const disabled = !store.connected || !supported || busy
  const owner = { runtimeId: store.activeRuntimeId, online: store.connected, name: 'This computer' }
  const client = taskActionClient(store, owner)
  const change = (change: Partial<Draft>) => {
    const next = { ...value, ...change }
    drafts.set(scope, next)
    setDraft(next)
    setNotice('')
  }
  const run = async (operation: () => Promise<void>) => {
    if (disabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const refresh = async () => {
    try {
      await client.refresh()
    } catch (cause) {
      setError(
        `Saved. The computer has not refreshed yet: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  return (
    <div className="grid gap-5 p-4 text-sm">
      <div hidden={section !== 'settings'} className="space-y-5">
        <section className="grid gap-2">
          <h2 className="font-semibold">Assistant</h2>
          <p role="status" className="text-xs text-muted-foreground">
            {hostBot.state === 'paused'
              ? 'Paused. Messages queue until you resume. Current work may finish.'
              : 'Active. This thread keeps your Bot’s conversation and work.'}
          </p>
          {!store.connected && <p role="status">This computer is offline. Your draft is kept.</p>}
          {!supported && <p role="status">Update this runtime to manage Bots.</p>}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const result = await client.request(
                  '/api/bots/lifecycle',
                  {
                    id: task.id,
                    action: hostBot.state === 'paused' ? 'resume' : 'pause',
                    expectedRevision: hostBot.revision,
                  },
                  botResultSchema,
                )
                setAck({ before: task.bot?.revision ?? hostBot.revision, bot: result.bot })
                // Our own lifecycle change does not invalidate an otherwise current settings draft.
                if (
                  draft &&
                  draft.revision === hostBot.revision &&
                  drafts.get(scope) === draft &&
                  result.bot.role === draft.originalRole &&
                  result.bot.responsibilities === draft.originalResponsibilities
                ) {
                  const next = { ...draft, revision: result.bot.revision }
                  drafts.set(scope, next)
                  setDraft(next)
                }
                await refresh()
              })
            }
          >
            {hostBot.state === 'paused' ? 'Resume Bot' : 'Pause Bot'}
          </Button>
        </section>
        <BotAvatarEditor
          task={{ ...task, bot: hostBot }}
          onSaved={(result) => {
            setAck({ before: task.bot?.revision ?? hostBot.revision, bot: result.bot })
            if (
              draft &&
              draft.revision === hostBot.revision &&
              drafts.get(scope) === draft &&
              result.bot.role === draft.originalRole &&
              result.bot.responsibilities === draft.originalResponsibilities
            ) {
              const next = { ...draft, revision: result.bot.revision }
              drafts.set(scope, next)
              setDraft(next)
            }
            void refresh()
          }}
        />
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              // Keep the revision from the first edit. A concurrent edit must not be overwritten.
              const result = await client.request(
                '/api/bots/update',
                {
                  id: task.id,
                  expectedRevision: value.revision,
                  role: value.role.trim(),
                  responsibilities: value.responsibilities,
                },
                botResultSchema,
              )
              setAck({ before: task.bot?.revision ?? hostBot.revision, bot: result.bot })
              const acknowledged = {
                ...value,
                revision: result.bot.revision,
                originalRole: result.bot.role,
                originalResponsibilities: result.bot.responsibilities,
              }
              if (drafts.get(scope) === draft) drafts.set(scope, acknowledged)
              setDraft(acknowledged)
              if (value.name.trim() !== value.originalName) {
                const renamed = await client.request(
                  '/api/workspace',
                  taskRowPatch(
                    { ...task, title: value.originalName },
                    { title: value.name.trim() },
                  ),
                  workspacePatchResultSchema,
                  'PATCH',
                )
                if (renamed.outcome === 'rejected' || renamed.reconciled)
                  throw new Error(
                    'The Bot name changed on this computer. Your draft is kept. Reload its name before trying again.',
                  )
              }
              if (drafts.get(scope) === acknowledged) drafts.delete(scope)
              setDraft(undefined)
              setNotice('Bot settings saved.')
              await refresh()
            })
          }}
        >
          <fieldset disabled={disabled} className="grid min-w-0 gap-3">
            <FormField label="Name">
              <Input
                aria-label="Bot name"
                required
                value={value.name}
                onChange={(event) => change({ name: event.target.value })}
              />
            </FormField>
            <FormField label="Role">
              <Input
                aria-label="Bot role"
                required
                maxLength={120}
                value={value.role}
                onChange={(event) => change({ role: event.target.value })}
              />
            </FormField>
            <FormField label="Responsibilities">
              <Textarea
                aria-label="Bot responsibilities"
                maxLength={8000}
                rows={5}
                value={value.responsibilities}
                onChange={(event) => change({ responsibilities: event.target.value })}
              />
            </FormField>
            <Button
              type="submit"
              size="sm"
              disabled={!dirty || !value.name.trim() || !value.role.trim()}
            >
              {busy ? 'Saving…' : 'Save Bot settings'}
            </Button>
          </fieldset>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                drafts.delete(scope)
                setDraft(undefined)
                setError('')
              }}
            >
              Discard settings draft
            </Button>
          )}
        </form>
        <section className="grid gap-3">
          <h2 className="font-semibold">Harness, model and tool permissions</h2>
          <ComposerHarnessControls
            task={task}
            disabled={disabled}
            renderControls={({ model, access }) => (
              <div className="grid gap-3">
                {model}
                {access}
              </div>
            )}
          />
          <p className="text-xs text-muted-foreground">
            These are the thread’s actual settings. Changes apply through the existing harness
            controls. Browser sessions follow the runtime’s browser settings.
          </p>
        </section>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs">
          {notice}
        </p>
      )}
      {(section === 'mcp' || section === 'skill') &&
        store.snapshot?.botResourcesSupported !== true && (
          <p role="status">Update this runtime to manage Bot resources.</p>
        )}
      {store.snapshot?.botResourcesSupported === true &&
        (['mcp', 'skill'] as const).map((kind) => (
          <div key={kind} hidden={section !== kind}>
            <BotResourceEditor
              kind={kind}
              value={hostBot.resources ?? emptyBotResources()}
              inherited={taskResources(
                { ...task, bot: task.bot && { ...task.bot, resources: undefined } },
                store.workspace,
                store.snapshot?.defaults,
              )}
              disabled={disabled}
              onChange={async (resources: BotResources) => {
                if (disabled || lock.current) throw Error('Wait for the current save to finish.')
                lock.current = true
                setBusy(true)
                setError('')
                try {
                  const result = await client.request(
                    '/api/bots/update',
                    {
                      id: task.id,
                      expectedRevision: value.revision,
                      resources,
                    },
                    botResultSchema,
                  )
                  setAck({ before: task.bot?.revision ?? hostBot.revision, bot: result.bot })
                  // Only this confirmed write can advance a draft based on the same revision.
                  if (
                    draft &&
                    draft.revision === value.revision &&
                    drafts.get(scope) === draft &&
                    result.bot.role === draft.originalRole &&
                    result.bot.responsibilities === draft.originalResponsibilities
                  ) {
                    const next = { ...draft, revision: result.bot.revision }
                    drafts.set(scope, next)
                    setDraft(next)
                  }
                  await refresh()
                } finally {
                  lock.current = false
                  setBusy(false)
                }
              }}
            />
          </div>
        ))}
      {section === 'memory' && <BotMemory key={scope} taskId={task.id} />}
      {section === 'routines' && <BotRoutines taskId={task.id} />}
    </div>
  )
}
