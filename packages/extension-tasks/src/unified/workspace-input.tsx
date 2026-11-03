import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Globe2, MessageSquare, Monitor, Sparkles, Terminal } from 'lucide-react'
import {
  randomUUID,
  runtimeComputerName,
  terminalShellsResponseSchema,
  workspaceRouteSchema,
  type Task,
  type TerminalShell,
} from '@dovo/protocol'
import { createTask, resolveTaskDefaults, responses, useWorkspace } from '@dovo/studio-core'
import { Button, ChoicePicker, Input } from '@dovo/studio-ui'
import { browserAddress } from '../browser/shared-browser-tabs'
import type { WorkspaceTab } from './workspace-tabs'

type Destination = 'browser' | 'terminal' | 'thread'
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
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Destination | 'auto'>('auto')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newThread, setNewThread] = useState(false)
  const attempt = useRef(0)
  const submission = useRef<
    { text: string; context: string; messageId: string; task?: Task } | undefined
  >(undefined)
  const continuing =
    !newThread &&
    active?.kind === 'thread' &&
    !!active.id &&
    active.runtimeId === store.activeRuntimeId
  const [repositoryId, setRepositoryId] = useState('')
  const [shellId, setShellId] = useState('default')
  const [shellRetry, setShellRetry] = useState(0)
  const [catalog, setCatalog] = useState<{
    ownerId?: string
    shells?: TerminalShell[]
    error?: string
  }>({})
  const owner = store.runtimes.find((entry) => entry.profile.id === store.activeRuntimeId)
  const readRuntime = store.readRuntime
  useEffect(() => {
    if (mode !== 'terminal') return
    let current = true
    const ownerId = owner?.profile.id
    setCatalog({ ownerId })
    if (!owner || !store.connected) return
    void readRuntime(
      owner.profile,
      '/api/terminals/shells',
      {},
      terminalShellsResponseSchema,
      'POST',
    )
      .then(({ shells }) => {
        if (!current) return
        setCatalog({ ownerId, shells })
        setShellId((selected) =>
          shells.some((shell) => shell.id === selected) ? selected : 'default',
        )
      })
      .catch((cause: unknown) => {
        if (current) setCatalog({ ownerId, error: String(cause) })
      })
    return () => {
      current = false
    }
  }, [mode, owner?.profile.id, store.connected, readRuntime, shellRetry])
  const shellReady =
    catalog.ownerId === store.activeRuntimeId &&
    !!catalog.shells?.some((shell) => shell.id === shellId)
  const current = useRef({
    text,
    runtimeId: store.activeRuntimeId,
    activeKey: JSON.stringify(active),
  })
  current.current = { text, runtimeId: store.activeRuntimeId, activeKey: JSON.stringify(active) }
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  useEffect(() => {
    attempt.current++
    setBusy(false)
    setMode('auto')
    setReason('')
    setRepositoryId('')
    setShellId('default')
    setError('')
  }, [store.activeRuntimeId])

  const submit = async () => {
    if (busy || !text.trim()) return
    const generation = ++attempt.current
    const original = current.current
    const valid = () =>
      generation === attempt.current &&
      current.current.text === original.text &&
      current.current.runtimeId === original.runtimeId &&
      current.current.activeKey === original.activeKey
    setBusy(true)
    setError('')
    try {
      if (mode === 'auto') {
        const decision = await store.request(
          '/api/tasks/workspace/route',
          { text },
          workspaceRouteSchema,
        )
        if (valid()) {
          setMode(decision.mode)
          setReason(decision.reason)
        }
        return
      }
      if (mode === 'browser') {
        const url = browserAddress(text)
        if (!url) throw new Error('Enter a browser address.')
        await onBrowser(url)
      } else if (mode === 'terminal') {
        if (!shellReady) throw new Error('Choose an available shell before running the command.')
        const session = await store.request(
          '/api/terminals/workspace',
          { repositoryId: repositoryId || undefined, command: text, shellId },
          responses.terminal,
        )
        if (valid() && original.runtimeId)
          onOpen({ kind: 'terminal', runtimeId: original.runtimeId, id: session.id })
      } else {
        const context = JSON.stringify([
          original.runtimeId,
          continuing ? active?.id : 'new',
          repositoryId,
        ])
        if (submission.current?.text !== text || submission.current.context !== context)
          submission.current = { text, context, messageId: randomUUID() }
        const receipt = submission.current
        let id = continuing ? active?.id : receipt.task?.id
        if (!id) {
          const repository = store.workspace.repositories.find((repo) =>
            repositoryId ? repo.id === repositoryId : repo.kind === 'scratch',
          )
          if (!repository) throw new Error('Choose a project before starting a thread.')
          receipt.task = createTask({
            title: text.trim().slice(0, 80),
            objective: '',
            agentId: '',
            repositoryId: repository.id,
            ...resolveTaskDefaults(store.snapshot?.defaults, repository),
          })
          id = receipt.task.id
          const task = receipt.task
          store.setWorkspace((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
        }
        await store.flush()
        if (!valid()) return
        await store.request(
          '/api/tasks/message',
          { id, messageId: receipt.messageId, text, attachmentIds: [] },
          responses.ok,
        )
        if (valid() && original.runtimeId)
          onOpen({ kind: 'thread', runtimeId: original.runtimeId, id })
      }
      if (generation === attempt.current && current.current.text === original.text) {
        setText('')
        setMode('auto')
        setReason('')
        submission.current = undefined
      }
    } catch (cause) {
      if (generation === attempt.current) setError(String(cause))
    } finally {
      if (generation === attempt.current) setBusy(false)
    }
  }
  const actionLabel = busy
    ? 'Working…'
    : mode === 'auto'
      ? 'Choose destination'
      : mode === 'browser'
        ? 'Open browser'
        : mode === 'terminal'
          ? 'Run command'
          : continuing
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
  const computer = runtimeComputerName(
    store.runtimes.find((owner) => owner.profile.id === store.activeRuntimeId) ?? {},
  )
  return (
    <form
      aria-label="Workspace input"
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
        <Icon className="ml-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label="Workspace request"
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 md:text-sm"
          placeholder="Search the web, run a command, or ask anything…"
          maxLength={20000}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value)
            setMode('auto')
            setReason('')
            setError('')
          }}
        />
        <select
          aria-label="Workspace destination"
          title="Override the destination"
          className="h-8 max-w-24 shrink-0 rounded-md border-0 bg-muted/50 px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={mode}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value
            if (
              value === 'auto' ||
              value === 'browser' ||
              value === 'terminal' ||
              value === 'thread'
            ) {
              setMode(value)
              setReason('')
              setError('')
            }
          }}
        >
          <option value="auto">Auto</option>
          <option value="browser">Browser</option>
          <option value="terminal">Terminal</option>
          <option value="thread">Thread</option>
        </select>
        <Button
          type="submit"
          size="sm"
          aria-label={actionLabel}
          title={actionLabel}
          className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          disabled={
            busy ||
            !text.trim() ||
            (mode !== 'browser' && !store.connected) ||
            (mode === 'terminal' && !shellReady)
          }
        >
          <span className="hidden sm:inline">
            {mode === 'auto' && !busy ? 'Route' : actionLabel}
          </span>
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span role={reason ? 'status' : undefined}>
          {reason
            ? `Suggested ${mode}: ${reason}`
            : mode === 'auto'
              ? 'AI suggests a destination. Review it before opening or running.'
              : 'Destination selected. Ready when you are.'}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1" title={`Computer: ${computer}`}>
          <Monitor className="size-3 shrink-0" />
          <span className="max-w-40 truncate">{computer}</span>
        </span>
      </div>
      {(mode === 'terminal' || mode === 'thread') && (
        <div className="flex flex-wrap items-center gap-3 px-1 text-xs">
          {mode === 'terminal' && (
            <>
              <ChoicePicker
                aria-label="Workspace terminal shell"
                className="h-7 w-40 border-transparent bg-muted/40 text-xs shadow-none"
                value={shellId}
                disabled={busy || !shellReady}
                onValueChange={setShellId}
              >
                {catalog.ownerId === store.activeRuntimeId && catalog.shells ? (
                  catalog.shells.map((shell) => (
                    <option key={shell.id} value={shell.id}>
                      {shell.label}
                    </option>
                  ))
                ) : (
                  <option value="default">Loading shells…</option>
                )}
              </ChoicePicker>
              {catalog.ownerId === store.activeRuntimeId && catalog.error && (
                <span role="alert" className="text-destructive">
                  Could not load shells: {catalog.error}{' '}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShellRetry((value) => value + 1)}
                  >
                    Retry shells
                  </Button>
                </span>
              )}
            </>
          )}
          {mode === 'thread' && active?.kind === 'thread' && active.id && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={newThread}
                onChange={(event) => setNewThread(event.target.checked)}
                disabled={busy}
              />
              Start a new thread
            </label>
          )}
          {(!continuing || mode === 'terminal') && (
            <ChoicePicker
              aria-label="Workspace input project"
              className="h-7 w-48 border-transparent bg-muted/40 text-xs shadow-none"
              value={repositoryId}
              disabled={busy}
              onValueChange={setRepositoryId}
            >
              <option value="">{mode === 'terminal' ? 'Home folder' : 'General'}</option>
              {store.workspace.repositories
                .filter((repo) => repo.kind !== 'scratch')
                .map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
            </ChoicePicker>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
