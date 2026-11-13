import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowRight, ChevronDown, Monitor, SlidersHorizontal } from 'lucide-react'
import {
  botCreateSchema,
  botResultSchema,
  decode,
  randomUUID,
  RuntimeRequestError,
  sameRuntimeConnection,
  taskHarnessSchema,
  type BotCreate,
  type RuntimeProfile,
  type TaskHarness,
} from '@dovo/protocol'
import {
  createTask,
  defaultTaskHarness,
  resolveTaskAgent,
  resolveTaskDefaults,
  useConfirmation,
  useStudioHost,
  useWorkspace,
  WorkspaceRuntimeScope,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  FormField,
  HarnessFields,
  Input,
  Textarea,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'
import { botCreateHosts, botPairing, type BotCreateHost } from './bot-create-host'

type AgentDraft = { harness: TaskHarness }
type Pending = {
  profile: RuntimeProfile
  body: BotCreate
  createdId?: string
  refreshError?: string
}
type Draft = {
  id: string
  reviewError?: string
  name: string
  role: string
  responsibilities: string
  pairing?: number
  pending?: Pending
}
// Text follows the human. Agent choices and request identities belong to one exact pairing.
const emptyDraft = (): Draft => ({ id: randomUUID(), name: '', role: '', responsibilities: '' })
let session: { draft: Draft; inFlight: readonly string[] } = { draft: emptyDraft(), inFlight: [] }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const getSession = () => session
function publish(update: Partial<typeof session>) {
  session = { ...session, ...update }
  for (const listener of listeners) listener()
}
const requestKey = (request: Pending) => `${botPairing(request.profile)}:${request.body.requestId}`
const agents = new Map<number, AgentDraft>()
function agentDraft(host: BotCreateHost): AgentDraft {
  const previous = agents.get(host.pairing)
  if (previous) return previous
  const task = createTask({
    title: 'New Bot',
    objective: '',
    agentId: '',
    ...resolveTaskDefaults(host.snapshot?.defaults, undefined),
    repositoryId: '',
  })
  const value = {
    harness: decode(
      taskHarnessSchema,
      resolveTaskAgent(task, host.workspace?.agents ?? []) ?? defaultTaskHarness('codex'),
    ),
  }
  agents.set(host.pairing, value)
  return value
}

export function BotCreateForm({
  navigating,
  onCreated,
  onCancel,
}: {
  navigating: boolean
  onCreated: (id: string, profile: RuntimeProfile, refreshError?: string) => Promise<boolean>
  onCancel: () => void
}) {
  const store = useWorkspace()
  const latest = useRef(store)
  latest.current = store
  const studio = useStudioHost()
  const confirm = useConfirmation()
  const hosts = botCreateHosts(store)
  useState(() => {
    const savedDraft = session.draft
    const preferred =
      hosts.find(
        (host) => host.profile.id === store.activeRuntimeId && host.online && host.supported,
      ) ??
      hosts.find((host) => host.online && host.supported) ??
      hosts[0]
    const retained = savedDraft.pending || hosts.some((host) => host.pairing === savedDraft.pairing)
    session = {
      ...session,
      draft: { ...savedDraft, pairing: retained ? savedDraft.pairing : preferred?.pairing },
    }
    return null
  })
  const { draft, inFlight } = useSyncExternalStore(subscribe, getSession, getSession)
  const [, renderAgent] = useState(0)
  const [submitting, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const submission = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const host = hosts.find((item) => item.pairing === draft.pairing)
  const agent = host?.snapshot ? agentDraft(host) : undefined
  const scratch = host?.workspace?.repositories.find((item) => item.kind === 'scratch')
  const pending = draft.pending
  const busy = submitting || (!!pending && inFlight.includes(requestKey(pending)))
  const disabled = busy || !host?.online || !host.supported || (!pending && !scratch)
  const change = (update: Partial<Draft>) => {
    if (!mounted.current || session.draft.id !== draft.id) return
    publish({ draft: { ...session.draft, ...update } })
  }
  // A late completion can update only its retained draft and exact request/pairing.
  const ownsRequest = (request: Pending) =>
    session.draft.id === draft.id &&
    !!session.draft.pending &&
    requestKey(session.draft.pending) === requestKey(request)
  const updateRequest = (request: Pending, update: Partial<Draft>) => {
    if (!ownsRequest(request)) return false
    publish({ draft: { ...session.draft, ...update } })
    return true
  }
  const open = async (request: Pending) => {
    if (!request.createdId || !mounted.current || !ownsRequest(request)) return
    if (
      !botCreateHosts(latest.current).some((item) => item.pairing === botPairing(request.profile))
    ) {
      throw Error('This computer’s pairing changed. The Bot was created on its original computer.')
    }
    const opened = await onCreated(request.createdId, request.profile, request.refreshError)
    if (opened && ownsRequest(request)) publish({ draft: emptyDraft() })
  }
  const discard = async () => {
    if (!pending) return
    const accepted = await confirm({
      title: 'Discard creation request?',
      description: pending.createdId
        ? 'This Bot was already created. This removes only the saved request to open it. The Bot stays on its computer.'
        : 'This Bot may already exist. Check Bots on the original computer first. This removes only the local creation request. It does not undo work or discard saved actions.',
      confirmLabel: 'Discard creation request',
      destructive: true,
    })
    if (!accepted || !mounted.current || !ownsRequest(pending)) return
    const available = botCreateHosts(latest.current)
    const next = available.find((item) => item.online && item.supported) ?? available[0]
    updateRequest(pending, { pending: undefined, pairing: next?.pairing })
    submission.current++
    lock.current = false
    setBusy(false)
    setError('')
  }
  return (
    <section className="min-h-0 flex-1 overflow-y-auto" aria-label="Create Bot">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="mb-8 flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Your ongoing assistant
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Create your Bot</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Give it a role. Keep one lasting conversation, with memory and routines that help with
              your daily work.
            </p>
          </div>
        </header>
        <form
          className="grid min-w-0 gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (disabled || lock.current || !host || !agent || session.draft !== draft) return
            const attempt = ++submission.current
            lock.current = true
            setBusy(true)
            setError('')
            const activeAtStart = store.activeRuntimeId
            const connectionAtStart = store.connection
            let operationKey: string | undefined
            void (async () => {
              let request = pending
              try {
                if (request?.createdId) {
                  await open(request)
                  return
                }
                if (!request) {
                  const issue = permissionPolicyUIIssue(
                    agent.harness,
                    host.snapshot?.permissionPolicySupported === true,
                  )
                  if (issue) throw Error(issue)
                  request = {
                    profile: host.profile,
                    body: decode(botCreateSchema, {
                      requestId: randomUUID(),
                      createTask: {
                        ...createTask({
                          title: draft.name.trim(),
                          objective: '',
                          ...resolveTaskDefaults(host.snapshot?.defaults, undefined),
                          modelSelection: undefined,
                          agentId: '',
                          repositoryId: scratch?.id ?? '',
                          harness: agent.harness,
                          execution: 'main',
                          setupCommand: undefined,
                          worktreeBaseBranch: undefined,
                          worktreeFromOrigin: undefined,
                        }),
                        harnessCustomized: true,
                      },
                      role: draft.role.trim(),
                      responsibilities: draft.responsibilities,
                    }),
                  }
                  change({ pending: request })
                }
                const key = requestKey(request)
                if (session.inFlight.includes(key)) return
                operationKey = key
                publish({ inFlight: [...session.inFlight, operationKey] })
                // Explicit-owner transport validates the captured credentials before and after I/O.
                // taskActionClient's active branch uses the active request; do not borrow that here.
                const result = await store.readRuntime(
                  request.profile,
                  '/api/bots/create',
                  request.body,
                  botResultSchema,
                )
                request = { ...request, createdId: result.id }
                if (!updateRequest(request, { pending: request })) return
                try {
                  await store.refreshRuntime(request.profile)
                } catch (cause) {
                  request = {
                    ...request,
                    refreshError: `Bot created. Waiting for its computer to refresh: ${cause instanceof Error ? cause.message : String(cause)}`,
                  }
                  if (!updateRequest(request, { pending: request })) return
                }
                const current = latest.current
                if (
                  mounted.current &&
                  current.activeRuntimeId === activeAtStart &&
                  sameRuntimeConnection(current.connection, connectionAtStart)
                )
                  await open(request)
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause)
                const rejected =
                  cause instanceof RuntimeRequestError &&
                  cause.mutationRejected &&
                  !request?.createdId
                const review = rejected || /saved action.*needs review/i.test(message)
                if (request && review)
                  updateRequest(request, {
                    ...(rejected ? { pending: undefined } : {}),
                    reviewError: rejected
                      ? 'Creation was rejected. A saved action can still block new requests. Open Computers and review saved actions for the original computer before trying again.'
                      : 'A saved action needs review. Open Computers and review saved actions for the original computer before trying again.',
                  })
                if (
                  mounted.current &&
                  attempt === submission.current &&
                  session.draft.id === draft.id
                )
                  setError(message)
              } finally {
                if (operationKey)
                  publish({ inFlight: session.inFlight.filter((key) => key !== operationKey) })
                if (attempt === submission.current) {
                  lock.current = false
                  if (mounted.current) setBusy(false)
                }
              }
            })()
          }}
        >
          <fieldset
            disabled={busy || !!pending}
            className="grid min-w-0 gap-5 rounded-xl border bg-card p-5 sm:p-6"
          >
            <legend className="sr-only">Bot purpose</legend>
            <h2 className="flex items-center gap-3 text-sm font-semibold">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                1
              </span>{' '}
              Give it a purpose
            </h2>
            <FormField label="Role">
              <Input
                aria-label="Bot role"
                required
                maxLength={120}
                value={draft.role}
                onChange={(event) => change({ role: event.target.value })}
                placeholder="Keep releases ready to ship"
              />
              <p className="text-xs text-muted-foreground">What should this Bot help you do?</p>
            </FormField>
            <FormField label="Name">
              <Input
                aria-label="Bot name"
                required
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                placeholder="Release assistant"
              />
            </FormField>
            <FormField label="Responsibilities · optional">
              <Textarea
                aria-label="Bot responsibilities"
                rows={3}
                maxLength={8000}
                value={draft.responsibilities}
                onChange={(event) => change({ responsibilities: event.target.value })}
                placeholder="Review release notes, track blockers, and help prepare each release."
              />
            </FormField>
          </fieldset>
          <section
            className="grid min-w-0 gap-4 rounded-xl border bg-card p-5 sm:p-6"
            aria-label="Bot computer settings"
          >
            <h2 className="flex items-center gap-3 text-sm font-semibold">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                2
              </span>{' '}
              Runs on
            </h2>
            <div className="flex min-w-0 items-start gap-3">
              <Monitor className="mt-2 size-4 shrink-0 text-muted-foreground" />
              <div className="grid min-w-0 flex-1 gap-2">
                <ChoicePicker
                  aria-label="Bot computer"
                  value={String(draft.pairing ?? '')}
                  disabled={busy || !!pending}
                  onValueChange={(value) => {
                    change({ pairing: Number(value) })
                    setError('')
                  }}
                >
                  {!host && (
                    <option value={String(draft.pairing ?? '')}>
                      Original computer unavailable
                    </option>
                  )}
                  {hosts.map((item) => (
                    <option key={item.pairing} value={String(item.pairing)}>
                      {item.name}
                      {item.local ? ' · Local' : ''} · {item.online ? 'Online' : 'Offline'}
                      {item.supported ? '' : ' · Update required'}
                    </option>
                  ))}
                </ChoicePicker>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your Bot stays on this paired computer. Its files and tools run here.
                </p>
              </div>
            </div>
            {!host ? (
              <p role="status" className="text-sm text-muted-foreground">
                This computer was removed or its pairing changed.{' '}
                {pending
                  ? 'The original request is kept. A new pairing cannot retry it. Check Bots on the original computer before discarding this local request.'
                  : 'Choose a saved computer to continue.'}
              </p>
            ) : !host.online ? (
              <p role="status" className="text-sm text-muted-foreground">
                This computer is offline. Your draft is kept.
              </p>
            ) : !host.supported ? (
              <p role="status" className="text-sm text-muted-foreground">
                Update this runtime to create Bots.
              </p>
            ) : !scratch && !pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                This runtime has no safe scratch folder for a Bot.
              </p>
            ) : null}
          </section>
          {host && agent && (
            <details className="group min-w-0 rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-5 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:px-6">
                <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Agent settings</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Harness, model and permissions · optional
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
              </summary>
              <fieldset
                disabled={busy || !!pending || !host.online || !host.supported}
                className="min-w-0 border-t p-5 sm:p-6"
              >
                <WorkspaceRuntimeScope key={host.pairing} runtimeId={host.profile.id}>
                  <HarnessFields
                    value={agent.harness}
                    onChange={(harness) => {
                      if (
                        !mounted.current ||
                        session.draft.id !== draft.id ||
                        session.draft.pending ||
                        session.draft.pairing !== host.pairing
                      )
                        return
                      agents.set(host.pairing, { harness })
                      renderAgent((value) => value + 1)
                    }}
                  />
                </WorkspaceRuntimeScope>
              </fieldset>
            </details>
          )}
          {pending && (
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              {pending.createdId
                ? 'Your Bot was created. Open its conversation when you are ready.'
                : 'The creation request is kept on its original computer. Retry sends the exact same request and cannot create a second Bot.'}
            </p>
          )}
          {draft.reviewError && (
            <div role="status" className="grid gap-2 text-sm text-muted-foreground">
              <p>{draft.reviewError}</p>
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => studio.navigate({ viewId: 'runtime' })}
              >
                Open computers
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={disabled || !draft.name.trim() || !draft.role.trim()}>
              {busy
                ? 'Creating…'
                : pending?.createdId
                  ? 'Open Bot'
                  : pending
                    ? 'Retry creation'
                    : 'Create Bot'}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
            {pending && !host && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void discard().catch((cause) => {
                    if (mounted.current)
                      setError(cause instanceof Error ? cause.message : String(cause))
                  })
                }
              >
                Discard creation request
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={navigating} onClick={onCancel}>
              Back to Bots
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            After creation, add tools, memory and routines in Bot settings. You can change its role
            and agent settings there too.
          </p>
        </form>
      </div>
    </section>
  )
}
