import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Database,
  MessageCircle,
  Monitor,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react'
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
  const uiText = useInterfaceText()

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
    <section className="@container min-h-0 flex-1 overflow-y-auto" aria-label="Create Bot">
      <div className="mx-auto w-full max-w-6xl px-5 py-7 @3xl:px-8 @3xl:py-10">
        <header className="mb-7 @3xl:mb-9">
          <h1 className="text-3xl font-semibold tracking-tight @3xl:text-4xl">Create your Bot</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground @3xl:text-base">
            One conversation. Its own memory. A role that lasts.
          </p>
        </header>
        <form
          className="grid min-w-0 grid-cols-1 gap-5 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)] @3xl:gap-6"
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
            className="order-2 grid min-w-0 content-start gap-5 rounded-xl border bg-card p-5 @3xl:order-none @3xl:col-start-1 @3xl:row-span-2 @3xl:row-start-1 @3xl:p-6"
          >
            <legend className="sr-only">Bot purpose</legend>
            <h2 className="text-lg font-semibold tracking-tight">Give it a role</h2>
            <FormField label={uiText('Name')}>
              <Input
                aria-label="Bot name"
                required
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                placeholder="Release assistant"
              />
            </FormField>
            <FormField label={uiText('Role')}>
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
            <FormField label="Responsibilities · optional">
              <Textarea
                aria-label="Bot responsibilities"
                rows={5}
                className="min-h-32 resize-y"
                maxLength={8000}
                value={draft.responsibilities}
                onChange={(event) => change({ responsibilities: event.target.value })}
                placeholder="Review release notes, track blockers, and help prepare each release."
              />
            </FormField>
          </fieldset>
          <section
            className="order-1 grid min-w-0 content-start gap-4 rounded-xl border bg-card p-5 @3xl:order-none @3xl:col-start-2 @3xl:row-start-1 @3xl:p-6"
            aria-label="Bot computer settings"
          >
            <h2 className="text-lg font-semibold tracking-tight">Runs on</h2>
            <div className="grid min-w-0 gap-3 rounded-lg bg-muted/40 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">
                    {host?.name ?? 'Original computer unavailable'}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {host ? (
                      <>
                        <span>{host.online ? 'Online' : 'Offline'}</span>
                        {host.local && <span>· Local</span>}
                        {!host.supported && <span>· Update required</span>}
                      </>
                    ) : (
                      'Pairing unavailable'
                    )}
                  </p>
                </div>
              </div>
              <ChoicePicker
                aria-label="Bot computer"
                className="min-h-10 bg-background"
                value={String(draft.pairing ?? '')}
                disabled={busy || !!pending}
                onValueChange={(value) => {
                  change({ pairing: Number(value) })
                  setError('')
                }}
              >
                {!host && (
                  <option value={String(draft.pairing ?? '')}>Original computer unavailable</option>
                )}
                {hosts.map((item) => (
                  <option key={item.pairing} value={String(item.pairing)}>
                    {item.name}
                    {item.local ? ' · Local' : ''} · {item.online ? 'Online' : 'Offline'}
                    {item.supported ? '' : ' · Update required'}
                  </option>
                ))}
              </ChoicePicker>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This computer hosts your Bot and runs its work.
            </p>
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
            <details className="group order-3 min-w-0 rounded-xl border bg-card @3xl:order-none @3xl:col-start-1 @3xl:row-start-3">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-5 text-sm focus-visible:outline-2 focus-visible:outline-ring @3xl:px-6">
                <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Agent settings</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Advanced · harness, model and permissions
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
              </summary>
              <fieldset
                disabled={busy || !!pending || !host.online || !host.supported}
                className="min-w-0 border-t p-5 @3xl:p-6"
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
          <section
            aria-label="Your Bot gets"
            className="order-4 grid min-w-0 content-start gap-5 rounded-xl border bg-card p-5 @3xl:order-none @3xl:col-start-2 @3xl:row-start-2 @3xl:p-6"
          >
            <h2 className="text-lg font-semibold tracking-tight">Your Bot gets</h2>
            <ul className="grid gap-5">
              <li className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">One lasting conversation</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    One thread for its ongoing work.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Private memory</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Keep notes and context for this Bot.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Workflow className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Routines and tools</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Add repeat work and choose the tools it can use.
                  </p>
                </div>
              </li>
            </ul>
          </section>
          {(pending || draft.reviewError || error) && (
            <div className="order-5 grid min-w-0 gap-3 @3xl:col-span-2">
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
            </div>
          )}
          <div className="order-6 flex min-w-0 flex-wrap items-center gap-3 border-t pt-5 @3xl:col-span-2 @3xl:pt-6">
            <Button type="button" variant="outline" disabled={navigating} onClick={onCancel}>
              <ArrowLeft className="size-4" />
              Back to Bots
            </Button>
            <p className="order-last w-full text-xs leading-relaxed text-muted-foreground @3xl:order-none @3xl:w-auto @3xl:flex-1 @3xl:text-center">
              Change instructions and tools later in Bot settings.
            </p>
            <Button
              className="ml-auto min-h-10 px-5"
              type="submit"
              disabled={disabled || !draft.name.trim() || !draft.role.trim()}
            >
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
          </div>
        </form>
      </div>
    </section>
  )
}
