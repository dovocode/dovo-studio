import { botScope } from './bot-scope'
import { useEffect, useRef, useState } from 'react'
import {
  botCreateSchema,
  botResultSchema,
  decode,
  randomUUID,
  RuntimeRequestError,
  taskHarnessSchema,
  type BotCreate,
  type TaskHarness,
} from '@dovo/protocol'
import {
  createTask,
  defaultTaskHarness,
  resolveTaskAgent,
  resolveTaskDefaults,
  useWorkspace,
} from '@dovo/studio-core'
import {
  Button,
  FormField,
  HarnessFields,
  Input,
  Textarea,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'
import { taskActionClient } from '../list/task-row-actions'

type Draft = {
  name: string
  role: string
  responsibilities: string
  repositoryId: string
  harness: TaskHarness
  pending?: BotCreate
}
const drafts = new Map<string, Draft>()

export function BotCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string, refreshError?: string) => void
  onCancel: () => void
}) {
  const store = useWorkspace()
  const scope = JSON.stringify([
    botScope(store.snapshot?.runtimeId ?? store.activeRuntimeId, store.connection),
    'create-bot',
  ])
  const [draft, setDraft] = useState<Draft>(() => {
    const previous = drafts.get(scope)
    if (previous) return previous
    const repository = store.workspace.repositories.find((item) => item.kind === 'scratch')
    const defaults = resolveTaskDefaults(store.snapshot?.defaults, undefined)
    const task = createTask({
      title: 'New Bot',
      objective: '',
      agentId: '',
      ...defaults,
      repositoryId: repository?.id ?? '',
    })
    return {
      name: '',
      role: '',
      responsibilities: '',
      repositoryId: task.repositoryId,
      harness: decode(
        taskHarnessSchema,
        resolveTaskAgent(task, store.workspace.agents) ?? defaultTaskHarness('codex'),
      ),
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const supported = store.snapshot?.botsSupported === true
  const scratch = store.workspace.repositories.find((item) => item.kind === 'scratch')
  const availableProject = !!scratch
  const disabled = busy || !store.connected || !supported || (!draft.pending && !availableProject)
  const change = (update: Partial<Draft>) => {
    const next = { ...draft, ...update }
    drafts.set(scope, next)
    setDraft(next)
  }
  return (
    <section className="mx-auto w-full max-w-xl overflow-y-auto p-6" aria-label="Create Bot">
      <h1 className="text-lg font-semibold">Create a Bot</h1>
      <p className="mb-5 mt-2 text-sm text-muted-foreground">
        Give an ongoing assistant a role and responsibilities. It keeps one conversation, its own
        memory and the permissions you choose.
      </p>
      {!store.connected && (
        <p role="status" className="mb-3 text-sm">
          This computer is offline. Your draft is kept.
        </p>
      )}
      {!supported && (
        <p role="status" className="mb-3 text-sm">
          Update this runtime to create Bots.
        </p>
      )}
      {!availableProject && !draft.pending && (
        <p role="status" className="mb-3 text-sm">
          This runtime has no safe scratch folder for a Bot.
        </p>
      )}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (disabled || lock.current) return
          lock.current = true
          setBusy(true)
          setError('')
          void (async () => {
            try {
              const issue = permissionPolicyUIIssue(
                draft.harness,
                store.snapshot?.permissionPolicySupported === true,
              )
              if (issue) throw Error(issue)
              const repository = scratch
              const input =
                draft.pending ??
                decode(botCreateSchema, {
                  requestId: randomUUID(),
                  createTask: {
                    ...createTask({
                      title: draft.name.trim(),
                      objective: '',
                      ...resolveTaskDefaults(store.snapshot?.defaults, undefined),
                      modelSelection: undefined,
                      agentId: '',
                      repositoryId: repository?.id ?? '',
                      harness: draft.harness,
                      ...(repository?.kind === 'scratch'
                        ? {
                            execution: 'main',
                            setupCommand: undefined,
                            worktreeBaseBranch: undefined,
                            worktreeFromOrigin: undefined,
                          }
                        : {}),
                    }),
                    harnessCustomized: true,
                  },
                  role: draft.role.trim(),
                  responsibilities: draft.responsibilities,
                })
              change({ pending: input })
              const client = taskActionClient(store, {
                runtimeId: store.activeRuntimeId,
                online: store.connected,
                name: 'This computer',
              })
              const result = await client.request('/api/bots/create', input, botResultSchema)
              drafts.delete(scope)
              // The snapshot owns Task.bot. Never put it into a client workspace PATCH.
              let refreshError: string | undefined
              try {
                await client.refresh()
              } catch (cause) {
                refreshError = `Bot created. Waiting for its computer to refresh: ${cause instanceof Error ? cause.message : String(cause)}`
              }
              if (mounted.current) onCreated(result.id, refreshError)
            } catch (cause) {
              if (cause instanceof RuntimeRequestError && cause.mutationRejected) {
                const current = drafts.get(scope)
                if (current) {
                  const editable = { ...current, pending: undefined }
                  drafts.set(scope, editable)
                  setDraft(editable)
                }
              }
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              lock.current = false
              setBusy(false)
            }
          })()
        }}
      >
        <fieldset
          disabled={busy || !store.connected || !supported || !!draft.pending}
          className="grid min-w-0 gap-3"
        >
          <FormField label="Name">
            <Input
              aria-label="Bot name"
              required
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              placeholder="Release assistant"
            />
          </FormField>
          <FormField label="Role">
            <Input
              aria-label="Bot role"
              required
              maxLength={120}
              value={draft.role}
              onChange={(event) => change({ role: event.target.value })}
              placeholder="Keep releases ready to ship"
            />
          </FormField>
          <FormField label="Responsibilities">
            <Textarea
              aria-label="Bot responsibilities"
              rows={4}
              maxLength={8000}
              value={draft.responsibilities}
              onChange={(event) => change({ responsibilities: event.target.value })}
              placeholder="Describe the work this assistant should own."
            />
          </FormField>
          <HarnessFields value={draft.harness} onChange={(harness) => change({ harness })} />
        </fieldset>
        {draft.pending && (
          <p role="status" className="text-xs text-muted-foreground">
            The creation request is kept. Retry sends the same request and cannot create a second
            Bot.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={disabled || !draft.name.trim() || !draft.role.trim()}>
            {busy ? 'Creating…' : draft.pending ? 'Retry creation' : 'Create Bot'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Back to Bots
          </Button>
        </div>
      </form>
    </section>
  )
}
