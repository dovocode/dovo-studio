import { useEffect, useRef, useState } from 'react'
import { randomUUID, runtimeComputerName, workspaceRouteSchema, type Task } from '@dovo/protocol'
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
        const session = await store.request(
          '/api/terminals/workspace',
          { repositoryId: repositoryId || undefined, command: text },
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
  return (
    <form
      aria-label="Workspace input"
      className="space-y-2 border-b p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Workspace request"
          className="min-w-48 flex-1"
          placeholder="Enter a URL, shell command, or request…"
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
        <ChoicePicker
          aria-label="Workspace destination"
          className="w-40 shrink-0"
          value={mode}
          disabled={busy}
          onValueChange={(value) => {
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
          <option value="auto">Auto · AI routing</option>
          <option value="browser">Browser</option>
          <option value="terminal">Terminal</option>
          <option value="thread">Thread</option>
        </ChoicePicker>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !text.trim() || (mode !== 'browser' && !store.connected)}
        >
          {busy
            ? 'Working…'
            : mode === 'auto'
              ? 'Choose destination'
              : mode === 'browser'
                ? 'Open browser'
                : mode === 'terminal'
                  ? 'Run command'
                  : continuing
                    ? 'Send to thread'
                    : 'Start thread'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Computer:{' '}
        {runtimeComputerName(
          store.runtimes.find((owner) => owner.profile.id === store.activeRuntimeId) ?? {},
        )}
      </p>
      {(mode === 'terminal' || mode === 'thread') && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {mode === 'thread' && active?.kind === 'thread' && active.id && (
            <label className="flex items-center gap-2">
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
              className="w-48"
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
          {mode === 'terminal' && (
            <span className="text-muted-foreground">
              Runs the original input in a new terminal on the current computer.
            </span>
          )}
        </div>
      )}
      {reason && (
        <p role="status" className="text-xs text-muted-foreground">
          Suggested {mode}: {reason} Change the destination above to override.
        </p>
      )}
      {mode === 'auto' && (
        <p className="text-xs text-muted-foreground">
          Uses the utility model configured in Settings → Agents. Classification never executes the
          input.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
