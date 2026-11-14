import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Schema } from 'effect'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Globe2,
  MessageSquare,
  Monitor,
  Sparkles,
  Terminal,
  House,
  Folder,
  MessageCircleDashed,
} from 'lucide-react'
import {
  randomUUID,
  snapshotSchema,
  runtimeComputerName,
  terminalShellsResponseSchema,
  workspacePatchResultSchema,
  workspaceRouteSchema,
  browserProfilesResultSchema,
  modelCatalogSchema,
  modelDiscoveryInput,
  suggestWorkspace,
  workspaceBrowserInput,
  workspaceModelChoices,
  harnessAvailabilitySchema,
  type WorkspaceModelChoice,
  type TaskHarness,
  type BrowserProfile,
  type Task,
  type TerminalShell,
} from '@dovo/protocol'
import {
  createTask,
  resolveTaskDefaults,
  responses,
  useAppPreferences,
  useWorkspace,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  ComposerSurface,
  ComposerSubmit,
  ComposerTextarea,
  ComposerWorkspaceBar,
  ProjectIcon,
  cn,
} from '@dovo/studio-ui'
import { StartupHeading } from '../task-creation/startup-heading'
import { TerminalCheckoutControls, useTerminalCheckout } from '../terminal/terminal-checkout'
import { TerminalRecoveryControl } from '../terminal/terminal-recovery-control'
import { browserAddress } from '../browser/shared-browser-tabs'
import type { WorkspaceTab } from './workspace-tabs'

type Destination = 'browser' | 'terminal' | 'thread'
type Submission = {
  key: string
  text: string
  messageId: string
  task?: Task
  created?: boolean
  sent?: boolean
  terminalId?: string
}

export function WorkspaceInput({
  active,
  visible = true,
  onOpen,
  onBrowser,
  children,
}: {
  active?: WorkspaceTab
  visible?: boolean
  children?: ReactNode
  onOpen: (tab: WorkspaceTab) => void
  onBrowser: (url: string, target?: { runtimeId: string; profileId: string }) => Promise<void>
}) {
  const uiText = useInterfaceText()

  const store = useWorkspace()
  const { minimalComposer, browserProfiles } = useAppPreferences()
  const [editorFocused, setEditorFocused] = useState(false)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Destination | 'auto'>('auto')
  const [suggested, setSuggested] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'routing' | 'submitting' | null>(null)
  // The draft owns its destination. Opening another resource must not retarget it.
  const [runtimeId, setRuntimeId] = useState(
    active?.runtimeId || store.activeRuntimeId || store.runtimes[0]?.profile.id || '',
  )
  const [repositoryId, setRepositoryId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [profileId, setProfileId] = useState('default')
  const [profiles, setProfiles] = useState<{ ownerId: string; items: BrowserProfile[] }>({
    ownerId: '',
    items: [],
  })
  const [models, setModels] = useState<{ key: string; items: WorkspaceModelChoice[] }>({
    key: '',
    items: [],
  })
  const [model, setModel] = useState<{ key: string; harness: TaskHarness } | null>(null)
  const modelKey = JSON.stringify([runtimeId, repositoryId])
  const [shellId, setShellId] = useState('default')
  const [rememberSession, setRememberSession] = useState(true)
  const [shellRetry, setShellRetry] = useState(0)
  const [catalog, setCatalog] = useState<{
    ownerId?: string
    shells?: TerminalShell[]
    error?: string
  }>({})
  const activeKey = JSON.stringify([visible, active?.kind, active?.runtimeId, active?.id])
  const navigation = useRef(activeKey)
  navigation.current = activeKey
  const revision = useRef(0)
  const pending = useRef<object | undefined>(undefined)
  const automaticStart = useRef<
    { revision: number; navigationKey: string; runtimeKey: string } | undefined
  >(undefined)
  const routing = useRef(false)
  const mounted = useRef(true)
  const draft = useRef(text)
  draft.current = text
  const submission = useRef<Submission | undefined>(undefined)
  const entry = store.runtimes.find((entry) => entry.profile.id === runtimeId)
  const checkout = useTerminalCheckout({ owner: entry, repositoryId, enabled: mode === 'terminal' })
  const connected = runtimeId === store.activeRuntimeId ? store.connected : !!entry?.connected
  const snapshot = runtimeId === store.activeRuntimeId ? store.snapshot : entry?.snapshot
  const workspace =
    runtimeId === store.activeRuntimeId ? store.workspace : entry?.snapshot?.workspace
  const thread = workspace?.tasks.find((task) => task.id === threadId)
  const activeThread =
    active?.kind === 'thread' && active.runtimeId === runtimeId
      ? workspace?.tasks.find((task) => task.id === active.id)
      : undefined
  const repository = workspace?.repositories.find((repo) =>
    repositoryId ? repo.id === repositoryId : repo.kind === 'scratch',
  )
  const computer = runtimeComputerName(entry ?? {})
  const runtimeKey = JSON.stringify([runtimeId, entry?.profile.connection])
  const currentRuntimeKey = useRef(runtimeKey)
  currentRuntimeKey.current = runtimeKey
  const visibleModels = models.key === modelKey ? models.items : []
  const readRuntime = store.readRuntime
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current++
    }
  }, [])
  useEffect(() => {
    if (mode !== 'terminal') return
    let current = true
    setCatalog({ ownerId: runtimeId })
    if (!entry || !connected) return
    void readRuntime(
      entry.profile,
      '/api/terminals/shells',
      {},
      terminalShellsResponseSchema,
      'POST',
    )
      .then(({ shells }) => {
        if (!current) return
        setCatalog({ ownerId: runtimeId, shells })
        setShellId((selected) =>
          shells.some((shell) => shell.id === selected) ? selected : 'default',
        )
      })
      .catch((cause: unknown) => {
        if (current)
          setCatalog({
            ownerId: runtimeId,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      })
    return () => {
      current = false
    }
  }, [mode, runtimeId, connected, readRuntime, shellRetry])
  const loadProfiles = async (id: string) => {
    if (id === store.localRuntimeId && browserProfiles?.length) return browserProfiles
    const owner = store.runtimes.find((entry) => entry.profile.id === id)
    if (!owner) throw new Error('This computer is no longer paired.')
    return (
      await readRuntime(
        owner.profile,
        '/api/previews/browser/profiles/read',
        {},
        browserProfilesResultSchema,
        'POST',
      )
    ).profiles
  }
  const loadModels = async (id: string, projectId: string) => {
    const owner = store.runtimes.find((entry) => entry.profile.id === id)
    const state = id === store.activeRuntimeId ? store.snapshot : owner?.snapshot
    if (!owner || !state) throw new Error('This computer is no longer available.')
    const availability = await readRuntime(
      owner.profile,
      '/api/agents/availability',
      { repositoryId: projectId || undefined },
      harnessAvailabilitySchema,
      'POST',
    )
    return workspaceModelChoices(
      state,
      projectId,
      (agent) =>
        readRuntime(
          owner.profile,
          '/api/agents/models/cached',
          modelDiscoveryInput(agent),
          Schema.NullOr(modelCatalogSchema),
          'POST',
        ),
      new Set(availability.filter((item) => item.available).map((item) => item.id)),
    )
  }
  useEffect(() => {
    if (mode !== 'browser' || (!connected && runtimeId !== store.localRuntimeId)) return
    let current = true
    void loadProfiles(runtimeId)
      .then((items) => {
        if (current) {
          setProfiles({ ownerId: runtimeId, items })
          setProfileId((id) => (items.some((profile) => profile.id === id) ? id : 'default'))
        }
      })
      .catch((cause: unknown) => {
        if (current) setError(`Could not load browser profiles: ${String(cause)}`)
      })
    return () => {
      current = false
    }
  }, [mode, runtimeId, connected])
  useEffect(() => {
    if (
      mode !== 'thread' ||
      threadId ||
      !connected ||
      !snapshot?.workspaceRoutingSelectionsSupported
    )
      return
    let current = true
    void loadModels(runtimeId, repositoryId)
      .then((items) => {
        if (current) setModels({ key: modelKey, items })
      })
      .catch((cause: unknown) => {
        if (current) setError(`Could not load model choices: ${String(cause)}`)
      })
    return () => {
      current = false
    }
  }, [mode, modelKey, threadId, connected, snapshot?.workspaceRoutingSelectionsSupported])
  const shells = catalog.ownerId === runtimeId ? catalog.shells : undefined
  const shellReady = !!shells?.some((shell) => shell.id === shellId)
  const busy = phase === 'submitting'
  const invalidate = (editedText = false) => {
    revision.current++
    automaticStart.current = undefined
    if (routing.current) {
      pending.current = undefined
      routing.current = false
      setPhase(null)
    }
    setError('')
    if (editedText) setReason('')
    if (editedText && suggested) {
      setMode('auto')
      setSuggested(false)
    }
  }
  const chooseMode = (value: string) => {
    if (value !== 'auto' && value !== 'browser' && value !== 'terminal' && value !== 'thread')
      return
    invalidate()
    setMode(value)
    setSuggested(false)
    setReason('')
  }
  const submit = async (startAfterSuggestion = false) => {
    const original = draft.current
    if (pending.current || automaticStart.current || (!original.trim() && mode !== 'terminal'))
      return
    if ((mode !== 'browser' || runtimeId !== store.localRuntimeId) && (!entry || !connected)) {
      setError('Choose an online computer before continuing.')
      return
    }
    const token = {}
    const version = revision.current
    const navigationKey = navigation.current
    const valid = () =>
      mounted.current && revision.current === version && currentRuntimeKey.current === runtimeKey
    pending.current = token
    routing.current = mode === 'auto'
    setPhase(mode === 'auto' ? 'routing' : 'submitting')
    setError('')
    let submitted: Submission | undefined
    try {
      if (mode === 'auto') {
        if (!entry) return
        const decision = await suggestWorkspace({
          text: original,
          runtimeId,
          repositoryId,
          continueThread: !!threadId,
          current: valid,
          computers: store.runtimes
            .filter((owner) =>
              owner.profile.id === store.activeRuntimeId ? store.connected : owner.connected,
            )
            .map((owner) => ({
              id: owner.profile.id,
              name: runtimeComputerName(owner),
              snapshot:
                owner.profile.id === store.activeRuntimeId ? store.snapshot : owner.snapshot,
            })),
          route: (id, input) => {
            const owner = store.runtimes.find((owner) => owner.profile.id === id)
            if (!owner) throw new Error('This computer is no longer paired.')
            return readRuntime(
              owner.profile,
              '/api/tasks/workspace/route',
              input,
              workspaceRouteSchema,
              'POST',
            )
          },
          models: loadModels,
          profiles: loadProfiles,
        })
        if (valid()) {
          const changedOwner = decision.runtimeId !== runtimeId
          setRuntimeId(decision.runtimeId)
          setRepositoryId(decision.repositoryId)
          if (changedOwner) {
            setThreadId('')
            setShellId('default')
            setModel(null)
          }
          if (decision.model)
            setModel({
              key: JSON.stringify([decision.runtimeId, decision.repositoryId]),
              harness: decision.model.harness,
            })
          if (decision.profileId) setProfileId(decision.profileId)
          if (decision.profiles)
            setProfiles({ ownerId: decision.runtimeId, items: decision.profiles })
          if (decision.mode === 'terminal') setCatalog({ ownerId: decision.runtimeId })
          setMode(decision.mode)
          setSuggested(true)
          setReason(decision.reason)
          if (startAfterSuggestion) {
            const owner = store.runtimes.find((owner) => owner.profile.id === decision.runtimeId)
            automaticStart.current = {
              revision: version,
              navigationKey,
              runtimeKey: JSON.stringify([decision.runtimeId, owner?.profile.connection]),
            }
          }
        }
        // Normal submission reviews suggestions. The explicit shortcut continues after render.
        return
      }
      if (mode === 'browser') {
        const url = browserAddress(workspaceBrowserInput(original))
        if (!url) throw new Error('Enter a browser address.')
        await onBrowser(url, { runtimeId, profileId })
      } else {
        if (!entry) throw new Error('This computer is no longer paired.')
        const key = JSON.stringify([
          mode,
          runtimeId,
          mode === 'thread' ? threadId : '',
          repositoryId,
          mode === 'terminal' ? shellId : '',
          mode === 'terminal' ? checkout.input : null,
          mode === 'thread' && model?.key === modelKey ? model.harness : null,
          mode === 'terminal'
            ? rememberSession && snapshot?.terminalRecoverySupported === true
            : false,
        ])
        if (submission.current?.key !== key || submission.current.text !== original) {
          const previous = submission.current
          submission.current = {
            key,
            text: original,
            messageId: randomUUID(),
            ...(mode === 'thread' && previous?.key === key
              ? { task: previous.task, created: previous.created }
              : {}),
          }
        }
        const receipt = submission.current
        submitted = receipt
        if (mode === 'terminal') {
          if (!checkout.ready)
            throw new Error('Choose an available checkout before running the command.')
          if (!shellReady) throw new Error('Choose an available shell before running the command.')
          if (repositoryId && !repository)
            throw new Error('This project is no longer available. Choose a project or Home folder.')
          if (!receipt.terminalId) {
            const session = await readRuntime(
              entry.profile,
              '/api/terminals/workspace',
              {
                repositoryId: repositoryId || undefined,
                command: original.trim() ? original : undefined,
                shellId,
                ...checkout.input,
                rememberSession: rememberSession && snapshot?.terminalRecoverySupported === true,
              },
              responses.terminal,
              'POST',
            )
            receipt.terminalId = session.id
          }
          if (valid() && navigation.current === navigationKey)
            onOpen({ kind: 'terminal', runtimeId, id: receipt.terminalId })
        } else {
          if (threadId && !thread)
            throw new Error('This thread is no longer available. Choose a new thread.')
          if (!threadId && !receipt.task) {
            let taskRepository = repository
            let defaults = snapshot?.defaults
            if (!taskRepository) {
              const fresh = await readRuntime(
                entry.profile,
                '/api/snapshot',
                undefined,
                snapshotSchema,
                'GET',
              )
              taskRepository = fresh.workspace.repositories.find((repo) =>
                repositoryId ? repo.id === repositoryId : repo.kind === 'scratch',
              )
              defaults = fresh.defaults
            }
            if (!taskRepository)
              throw new Error(
                repositoryId
                  ? 'This project is no longer available. Choose another project.'
                  : 'General threads are unavailable on this computer. Choose a project.',
              )
            receipt.task = createTask({
              title: original.trim().slice(0, 80),
              objective: '',
              agentId: '',
              ...resolveTaskDefaults(defaults, taskRepository),
              ...(model?.key === modelKey
                ? { harness: model.harness, harnessCustomized: true, modelSelection: undefined }
                : {}),
              repositoryId: taskRepository.id,
            })
          }
          const id = threadId || receipt.task?.id
          if (!id) throw new Error('Choose a thread before sending.')
          if (receipt.task && !receipt.created) {
            // Stable task/message IDs make retries resume the same submission.
            const result = await readRuntime(
              entry.profile,
              '/api/workspace',
              { collection: 'tasks', id, create: receipt.task, changes: {} },
              workspacePatchResultSchema,
              'PATCH',
            )
            if (result.outcome === 'rejected')
              throw new Error(result.reason ?? 'The new thread could not be saved.')
            receipt.created = true
          }
          // Submission was explicitly authorized. Draft edits or navigation only guard
          // UI updates; they must not abandon a saved task before its first message.
          if (!receipt.sent) {
            await readRuntime(
              entry.profile,
              '/api/tasks/message',
              { id, messageId: receipt.messageId, text: original, attachmentIds: [] },
              responses.ok,
              'POST',
            )
            receipt.sent = true
          }
          if (valid() && navigation.current === navigationKey)
            onOpen({ kind: 'thread', runtimeId, id })
        }
      }
      if (valid()) {
        draft.current = ''
        setText('')
        setMode('auto')
        setSuggested(false)
        setReason('')
        submission.current = undefined
        revision.current++
      }
    } catch (cause: unknown) {
      if (valid() || (mode !== 'auto' && mounted.current)) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(
          mode === 'thread' && submitted?.created && !submitted.sent
            ? `Thread saved on ${computer}, but its message could not be confirmed. Retry to use the same thread. ${message}`
            : message,
        )
      }
    } finally {
      if (pending.current === token) {
        pending.current = undefined
        routing.current = false
        if (mounted.current) setPhase(null)
      }
    }
  }
  useEffect(() => {
    const queued = automaticStart.current
    if (!queued || phase || pending.current) return
    if (
      queued.revision !== revision.current ||
      queued.navigationKey !== activeKey ||
      queued.runtimeKey !== runtimeKey ||
      mode === 'auto' ||
      (mode === 'terminal' && catalog.ownerId === runtimeId && catalog.error)
    ) {
      automaticStart.current = undefined
      return
    }
    // Terminal catalogs load after routing to the selected computer. Never run with a stale shell.
    if (mode === 'terminal' && (!shellReady || !checkout.ready)) return
    automaticStart.current = undefined
    void submit()
  }, [phase, mode, runtimeKey, activeKey, shellReady, checkout.ready, catalog])
  const actionLabel = phase
    ? 'Working…'
    : mode === 'auto'
      ? 'Choose destination'
      : mode === 'browser'
        ? 'Open browser'
        : mode === 'terminal'
          ? text.trim()
            ? 'Run command'
            : 'Open terminal'
          : threadId
            ? 'Send to thread'
            : 'Start thread'
  const target =
    mode === 'browser'
      ? 'Browser · New page'
      : mode === 'terminal'
        ? 'Terminal · New shell'
        : mode === 'thread'
          ? threadId
            ? `Thread · ${thread?.title ?? 'Unavailable thread'}`
            : 'Thread · New thread'
          : 'Choose a destination'
  const idle = !!minimalComposer && !editorFocused && !text.trim()
  return (
    <div
      className="startup-draft flex min-h-full w-full flex-1 shrink-0 flex-col"
      data-workspace-input
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEditorFocused(false)
      }}
    >
      <StartupHeading>
        <div className="flex min-h-9 max-w-full items-center justify-center">
          {mode !== 'browser' && !(mode === 'thread' && threadId) && (
            <div
              role="group"
              aria-label="Start in a project"
              className="flex max-w-full flex-wrap items-center justify-center gap-1.5"
            >
              <button
                type="button"
                aria-pressed={!repositoryId}
                disabled={busy || !connected}
                onClick={() => {
                  invalidate()
                  setRepositoryId('')
                }}
                className={cn(
                  'startup-no-project inline-flex items-center justify-center gap-2 rounded-lg border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                  !repositoryId ? 'border-primary bg-primary/5' : 'border-border bg-card',
                )}
              >
                {mode === 'terminal' ? (
                  <House className="size-4" />
                ) : (
                  <MessageCircleDashed className="size-4" />
                )}
                {mode === 'terminal' ? 'Home folder' : 'No Project'}
              </button>
              <div
                data-selected={!!repositoryId || undefined}
                className="startup-project-selector inline-flex min-w-0 max-w-full items-stretch"
              >
                <ChoicePicker
                  aria-label="Workspace input project"
                  className="h-9 w-auto max-w-64 border-0 bg-transparent text-sm shadow-none"
                  icons={Object.fromEntries([
                    ['', <Folder className="size-4" />],
                    ...(workspace?.repositories ?? []).map((repo) => [
                      repo.id,
                      <ProjectIcon repository={repo} className="size-4" />,
                    ]),
                  ])}
                  value={repositoryId}
                  disabled={busy || !connected}
                  onValueChange={(id) => {
                    invalidate()
                    setRepositoryId(id)
                  }}
                >
                  <option value="">Choose project</option>
                  {workspace?.repositories
                    .filter((repo) => repo.kind !== 'scratch')
                    .map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.name}
                      </option>
                    ))}
                </ChoicePicker>
              </div>
            </div>
          )}
          {mode === 'browser' && (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Globe2 className="size-4" />
              New browser page
            </span>
          )}
          {mode === 'thread' && threadId && (
            <span className="max-w-lg truncate text-sm text-muted-foreground">
              Continue: {thread?.title ?? 'Unavailable thread'}
            </span>
          )}
        </div>
      </StartupHeading>
      <div className="mb-auto w-full shrink-0 pb-8">
        <div className="task-composer min-w-0">
          <ComposerSurface
            aria-label="Workspace input"
            compact={idle}
            aria-busy={!!phase}
            error={error}
            controls={
              <>
                <ChoicePicker
                  aria-label="Workspace destination"
                  className="h-7 w-auto max-w-40 border-0 bg-transparent text-xs shadow-none"
                  icons={{
                    auto: <Sparkles className="size-3.5" />,
                    browser: <Globe2 className="size-3.5" />,
                    terminal: <Terminal className="size-3.5" />,
                    thread: <MessageSquare className="size-3.5" />,
                  }}
                  value={mode}
                  disabled={busy}
                  onValueChange={chooseMode}
                >
                  <option value="auto">Auto</option>
                  <option value="browser">{uiText('Browser')}</option>
                  <option value="terminal">{uiText('Terminal')}</option>
                  <option value="thread">Thread</option>
                </ChoicePicker>
                {mode === 'thread' && !threadId && (
                  <ChoicePicker
                    aria-label="Workspace thread model"
                    className="h-7 w-auto max-w-48 border-0 bg-transparent text-xs shadow-none"
                    disabled={busy || !connected}
                    value={
                      model?.key === modelKey
                        ? (visibleModels.find(
                            (item) =>
                              JSON.stringify(item.harness) === JSON.stringify(model.harness),
                          )?.id ?? 'selected')
                        : ''
                    }
                    onValueChange={(value) => {
                      invalidate()
                      const selected =
                        models.key === modelKey
                          ? visibleModels.find((item) => item.id === value)
                          : undefined
                      setModel(selected ? { key: modelKey, harness: selected.harness } : null)
                    }}
                  >
                    <option value="">Current model</option>
                    {models.key === modelKey &&
                      visibleModels.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    {model?.key === modelKey &&
                      !visibleModels.some(
                        (item) => JSON.stringify(item.harness) === JSON.stringify(model.harness),
                      ) && <option value="selected">{model.harness.model}</option>}
                  </ChoicePicker>
                )}
                {mode === 'browser' && (
                  <ChoicePicker
                    aria-label="Workspace browser profile"
                    className="h-7 w-auto max-w-44 border-0 bg-transparent text-xs shadow-none"
                    value={profileId}
                    disabled={busy || profiles.ownerId !== runtimeId}
                    onValueChange={(id) => {
                      invalidate()
                      setProfileId(id)
                    }}
                  >
                    {(profiles.ownerId === runtimeId
                      ? profiles.items
                      : [{ id: 'default', name: 'Default' }]
                    ).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </ChoicePicker>
                )}
                {mode === 'terminal' && (
                  <ChoicePicker
                    aria-label="Workspace terminal shell"
                    className="h-7 w-auto max-w-44 border-0 bg-transparent text-xs shadow-none"
                    value={shellId}
                    disabled={busy || !connected || !shells}
                    onValueChange={(id) => {
                      invalidate()
                      setShellId(id)
                    }}
                  >
                    {shells ? (
                      shells.map((shell) => (
                        <option key={shell.id} value={shell.id}>
                          {shell.label}
                        </option>
                      ))
                    ) : (
                      <option value="default">
                        {catalog.ownerId === runtimeId && catalog.error
                          ? 'Shells unavailable'
                          : 'Loading shells…'}
                      </option>
                    )}
                  </ChoicePicker>
                )}
              </>
            }
            actions={
              <ComposerSubmit
                aria-label={actionLabel}
                title={
                  mode === 'auto'
                    ? 'Suggest a destination to review. ⌘/Ctrl+Enter chooses and starts immediately.'
                    : actionLabel
                }
                busy={!!phase}
                disabled={
                  !!phase ||
                  (!text.trim() && mode !== 'terminal') ||
                  ((mode !== 'browser' || runtimeId !== store.localRuntimeId) && !connected) ||
                  (mode === 'terminal' && (!shellReady || !checkout.ready)) ||
                  (mode === 'thread' && !!threadId && !thread)
                }
              />
            }
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <ComposerTextarea
              aria-label="Workspace request"
              aria-keyshortcuts="Meta+Enter Control+Enter"
              autoFocus={!active && visible}
              preview={mode === 'thread'}
              placeholder={
                mode === 'terminal'
                  ? 'Run a command, or open a shell…'
                  : mode === 'browser'
                    ? 'Enter a URL or web search…'
                    : mode === 'thread'
                      ? threadId
                        ? 'Write a message to this thread…'
                        : 'What would you like to work on?'
                      : 'Search the web, run a command, or start a thread…'
              }
              className={mode === 'terminal' ? 'font-mono' : undefined}
              spellCheck={mode === 'thread'}
              autoCapitalize={mode === 'thread' ? 'sentences' : 'off'}
              autoCorrect={mode === 'thread' ? 'on' : 'off'}
              maxLength={20000}
              value={text}
              disabled={busy}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Enter' ||
                  (!event.metaKey && !event.ctrlKey) ||
                  event.shiftKey ||
                  event.altKey ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return
                event.preventDefault()
                if (!event.repeat) void submit(true)
              }}
              onFocus={() => setEditorFocused(true)}
              onChange={(event) => {
                invalidate(true)
                draft.current = event.target.value
                setText(event.target.value)
              }}
            />
          </ComposerSurface>
          <span className="sr-only" aria-label="Workspace input target">
            {target}
          </span>
          <ComposerWorkspaceBar>
            {mode === 'terminal' && (
              <TerminalRecoveryControl
                enabled={rememberSession}
                supported={snapshot?.terminalRecoverySupported === true}
                disabled={busy}
                onChange={(enabled) => {
                  invalidate()
                  setRememberSession(enabled)
                }}
              />
            )}
            <ChoicePicker
              aria-label="Workspace input computer"
              icons={Object.fromEntries(
                store.runtimes.map((owner) => [owner.profile.id, <Monitor className="size-3.5" />]),
              )}
              className="h-7 w-auto max-w-44 border-0 bg-transparent text-xs shadow-none"
              value={runtimeId}
              disabled={busy}
              onValueChange={(id) => {
                invalidate()
                setRuntimeId(id)
                setRepositoryId('')
                setShellId('default')
                setThreadId('')
                setProfileId('default')
                setModel(null)
              }}
            >
              {!store.runtimes.length && <option value="">No paired computers</option>}
              {store.runtimes.map((owner) => (
                <option key={owner.profile.id} value={owner.profile.id}>
                  {runtimeComputerName(owner)}
                  {(owner.profile.id === store.activeRuntimeId ? store.connected : owner.connected)
                    ? ''
                    : ' · offline'}
                </option>
              ))}
            </ChoicePicker>
            {mode === 'terminal' && (
              <TerminalCheckoutControls checkout={checkout} disabled={busy || !connected} />
            )}
            {mode === 'thread' && (
              <ChoicePicker
                aria-label="Workspace thread target"
                className="h-7 w-auto max-w-56 border-0 bg-transparent text-xs shadow-none"
                value={threadId}
                disabled={busy}
                onValueChange={(id) => {
                  invalidate()
                  setThreadId(id)
                }}
              >
                <option value="">{uiText('New thread')}</option>
                {threadId && (
                  <option value={threadId}>
                    Continue: {thread?.title ?? 'Unavailable thread'}
                  </option>
                )}
                {activeThread && activeThread.id !== threadId && (
                  <option value={activeThread.id}>Continue: {activeThread.title}</option>
                )}
              </ChoicePicker>
            )}
          </ComposerWorkspaceBar>
          {(reason || phase === 'routing') && (
            <p
              role="status"
              className="mx-auto mt-2 max-w-[var(--chat-max)] px-1 text-center text-xs text-muted-foreground"
            >
              {phase === 'routing'
                ? 'Choosing a destination…'
                : `Suggested ${mode}: ${reason}. Review the destination before continuing.`}
            </p>
          )}
          {mode === 'terminal' && catalog.ownerId === runtimeId && catalog.error && (
            <div role="alert" className="mt-1 px-1 text-xs text-destructive">
              Could not load shells: {catalog.error}{' '}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setShellRetry((value) => value + 1)}
              >
                Retry shells
              </Button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
