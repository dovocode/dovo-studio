import { useEffect, useRef, useState } from 'react'
import { Globe2, MessageSquare, Monitor, Sparkles, Terminal } from 'lucide-react'
import {
  randomUUID,
  snapshotSchema,
  runtimeComputerName,
  terminalShellsResponseSchema,
  workspacePatchResultSchema,
  workspaceRouteSchema,
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
} from '@dovo/studio-ui'
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
  onOpen,
  onBrowser,
}: {
  active?: WorkspaceTab
  onOpen: (tab: WorkspaceTab) => void
  onBrowser: (url: string) => Promise<void>
}) {
  const store = useWorkspace()
  const { minimalComposer } = useAppPreferences()
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
  const [shellId, setShellId] = useState('default')
  const [shellRetry, setShellRetry] = useState(0)
  const [catalog, setCatalog] = useState<{
    ownerId?: string
    shells?: TerminalShell[]
    error?: string
  }>({})
  const activeKey = active ? JSON.stringify([active.kind, active.runtimeId, active.id]) : ''
  const navigation = useRef(activeKey)
  navigation.current = activeKey
  const revision = useRef(0)
  const pending = useRef<object | undefined>(undefined)
  const routing = useRef(false)
  const mounted = useRef(true)
  const draft = useRef(text)
  draft.current = text
  const submission = useRef<Submission | undefined>(undefined)
  const entry = store.runtimes.find((entry) => entry.profile.id === runtimeId)
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
  const shells = catalog.ownerId === runtimeId ? catalog.shells : undefined
  const shellReady = !!shells?.some((shell) => shell.id === shellId)
  const busy = phase === 'submitting'
  const invalidate = (editedText = false) => {
    revision.current++
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
  const submit = async () => {
    const original = draft.current
    if (pending.current || !original.trim()) return
    if (mode !== 'browser' && (!entry || !connected)) {
      setError('Choose an online computer before continuing.')
      return
    }
    const token = {}
    const version = revision.current
    const navigationKey = navigation.current
    const valid = () => mounted.current && revision.current === version
    pending.current = token
    routing.current = mode === 'auto'
    setPhase(mode === 'auto' ? 'routing' : 'submitting')
    setError('')
    let submitted: Submission | undefined
    try {
      if (mode === 'auto') {
        if (!entry) return
        const decision = await readRuntime(
          entry.profile,
          '/api/tasks/workspace/route',
          { text: original },
          workspaceRouteSchema,
          'POST',
        )
        if (valid()) {
          setMode(decision.mode)
          setSuggested(true)
          setReason(decision.reason)
        }
        // A suggestion never opens a page, sends a message or runs a command.
        return
      }
      if (mode === 'browser') {
        const url = browserAddress(original)
        if (!url) throw new Error('Enter a browser address.')
        await onBrowser(url)
      } else {
        if (!entry) throw new Error('This computer is no longer paired.')
        const key = JSON.stringify([
          mode,
          runtimeId,
          mode === 'thread' ? threadId : '',
          repositoryId,
          mode === 'terminal' ? shellId : '',
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
          if (!shellReady) throw new Error('Choose an available shell before running the command.')
          if (repositoryId && !repository)
            throw new Error('This project is no longer available. Choose a project or Home folder.')
          if (!receipt.terminalId) {
            const session = await readRuntime(
              entry.profile,
              '/api/terminals/workspace',
              { repositoryId: repositoryId || undefined, command: original, shellId },
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
  const actionLabel = phase
    ? 'Working…'
    : mode === 'auto'
      ? 'Choose destination'
      : mode === 'browser'
        ? 'Open browser'
        : mode === 'terminal'
          ? 'Run command'
          : threadId
            ? 'Send to thread'
            : 'Start thread'
  const Icon =
    mode === 'terminal'
      ? Terminal
      : mode === 'browser'
        ? Globe2
        : mode === 'thread'
          ? MessageSquare
          : Sparkles
  const projectName =
    mode === 'thread' && threadId
      ? (workspace?.repositories.find((repo) => repo.id === thread?.repositoryId)?.name ??
        'General')
      : repositoryId
        ? (repository?.name ?? 'Unavailable project')
        : mode === 'terminal'
          ? 'Home folder'
          : 'General'
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
      className="startup-draft task-composer min-w-0"
      data-workspace-input
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEditorFocused(false)
      }}
    >
      <div
        className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs"
        aria-label="Workspace input target"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{target}</span>
        {mode !== 'browser' && (
          <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <Monitor className="size-3" aria-hidden="true" />
            <span className="truncate">
              {computer} · {projectName}
              {connected ? '' : ' · offline'}
            </span>
          </span>
        )}
      </div>
      <ComposerSurface
        aria-label="Workspace input"
        compact={idle}
        aria-busy={!!phase}
        error={error}
        controls={
          <ChoicePicker
            aria-label="Workspace destination"
            className="h-8 w-32 border-transparent bg-muted/40 text-xs shadow-none"
            value={mode}
            disabled={busy}
            onValueChange={chooseMode}
          >
            <option value="auto">Auto</option>
            <option value="browser">Browser</option>
            <option value="terminal">Terminal</option>
            <option value="thread">Thread</option>
          </ChoicePicker>
        }
        actions={
          <ComposerSubmit
            aria-label={actionLabel}
            title={actionLabel}
            busy={!!phase}
            disabled={
              !!phase ||
              !text.trim() ||
              (mode !== 'browser' && !connected) ||
              (mode === 'terminal' && !shellReady) ||
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
          preview={mode === 'thread'}
          placeholder={
            mode === 'terminal'
              ? 'Write a command to run in a new shell…'
              : mode === 'browser'
                ? 'Enter a URL or web search…'
                : mode === 'thread'
                  ? threadId
                    ? 'Write a message to this thread…'
                    : 'What would you like to work on?'
                  : 'Search the web, run a command, or start a thread…'
          }
          maxLength={20000}
          value={text}
          disabled={busy}
          onFocus={() => setEditorFocused(true)}
          onChange={(event) => {
            invalidate(true)
            draft.current = event.target.value
            setText(event.target.value)
          }}
        />
      </ComposerSurface>
      {mode !== 'browser' && (
        <ComposerWorkspaceBar>
          <ChoicePicker
            aria-label="Workspace input computer"
            className="h-7 max-w-44 border-transparent bg-transparent text-xs shadow-none"
            value={runtimeId}
            disabled={busy}
            onValueChange={(id) => {
              invalidate()
              setRuntimeId(id)
              setRepositoryId('')
              setShellId('default')
              setThreadId('')
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
          {mode === 'thread' && (
            <ChoicePicker
              aria-label="Workspace thread target"
              className="h-7 max-w-56 border-transparent bg-transparent text-xs shadow-none"
              value={threadId}
              disabled={busy}
              onValueChange={(id) => {
                invalidate()
                setThreadId(id)
              }}
            >
              <option value="">New thread</option>
              {threadId && (
                <option value={threadId}>Continue: {thread?.title ?? 'Unavailable thread'}</option>
              )}
              {activeThread && activeThread.id !== threadId && (
                <option value={activeThread.id}>Continue: {activeThread.title}</option>
              )}
            </ChoicePicker>
          )}
          {(mode === 'terminal' || (mode === 'thread' && !threadId)) && (
            <ChoicePicker
              aria-label="Workspace input project"
              className="h-7 max-w-48 border-transparent bg-transparent text-xs shadow-none"
              value={repositoryId}
              disabled={busy || !connected}
              onValueChange={(id) => {
                invalidate()
                setRepositoryId(id)
              }}
            >
              <option value="">{mode === 'terminal' ? 'Home folder' : 'General'}</option>
              {workspace?.repositories
                .filter((repo) => repo.kind !== 'scratch')
                .map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
            </ChoicePicker>
          )}
          {mode === 'terminal' && (
            <ChoicePicker
              aria-label="Workspace terminal shell"
              className="h-7 max-w-44 border-transparent bg-transparent text-xs shadow-none"
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
        </ComposerWorkspaceBar>
      )}
      <p
        role={reason ? 'status' : undefined}
        className="mt-2 px-1 text-[11px] text-muted-foreground"
      >
        {reason
          ? `Suggested ${mode}: ${reason}. Review the destination before continuing.`
          : mode === 'auto'
            ? 'AI suggests a destination. Review it before opening or running.'
            : mode === 'terminal'
              ? 'Runs only when you choose Run command. Use the terminal starter for worktrees.'
              : mode === 'thread' && !threadId
                ? 'Starts a new thread. Choose a continuation target to use an existing thread.'
                : 'Destination selected. Ready when you are.'}
      </p>
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
    </div>
  )
}
