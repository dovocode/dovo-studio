import { useEffect, useRef, useState } from 'react'
import { Folder, House } from 'lucide-react'
import { Schema } from 'effect'
import {
  branchesSchema,
  worktreeChoicesSchema,
  terminalShellsResponseSchema,
  runtimeComputerName,
  type CreateWorkspaceTerminal,
  type RuntimeOverview,
} from '@dovo/protocol'
import { responses, useAppPreferences, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  ComposerSurface,
  ComposerSubmit,
  ComposerTextarea,
  ComposerWorkspaceBar,
  cn,
} from '@dovo/studio-ui'

export function TerminalStarter({
  computers,
  onOpen,
}: {
  computers: readonly RuntimeOverview[]
  onOpen: (target: { runtimeId: string; id: string }) => void
}) {
  const store = useWorkspace()
  const { minimalComposer } = useAppPreferences()
  const [editorFocused, setEditorFocused] = useState(false)
  const [runtimeId, setRuntimeId] = useState(
    store.activeRuntimeId ?? computers[0]?.profile.id ?? '',
  )
  const [repositoryId, setRepositoryId] = useState('')
  const [command, setCommand] = useState('')
  const [shellId, setShellId] = useState('default')
  const [checkout, setCheckout] = useState<'main' | 'existing' | 'worktree'>('main')
  const [existingWorktreePath, setExistingWorktreePath] = useState('')
  const [worktreeBaseBranch, setWorktreeBaseBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shellRetry, setShellRetry] = useState(0)
  const [checkoutRetry, setCheckoutRetry] = useState(0)
  const [catalog, setCatalog] = useState<{
    ownerId: string
    data?: Schema.Schema.Type<typeof terminalShellsResponseSchema>
    error?: string
  }>({ ownerId: '' })
  const [checkoutOptions, setCheckoutOptions] = useState<{
    key: string
    branches?: Schema.Schema.Type<typeof branchesSchema>
    worktrees?: Schema.Schema.Type<typeof worktreeChoicesSchema>
    error?: string
  }>({ key: '' })
  const owner = computers.find((entry) => entry.profile.id === runtimeId)
  const profile = owner?.profile
  const connected = owner?.connected ?? false
  const readRuntime = store.readRuntime
  const attempt = useRef(0)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  useEffect(() => {
    let current = true
    setCatalog({ ownerId: runtimeId })
    if (!profile || !connected) return
    void readRuntime(profile, '/api/terminals/shells', {}, terminalShellsResponseSchema, 'POST')
      .then((data) => {
        if (!current) return
        setCatalog({ ownerId: runtimeId, data })
        setShellId((selected) =>
          data.shells.some((shell) => shell.id === selected) ? selected : 'default',
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
  }, [runtimeId, connected, shellRetry, readRuntime])
  const checkoutKey = JSON.stringify([runtimeId, repositoryId, checkout])
  useEffect(() => {
    let current = true
    setCheckoutOptions({ key: checkoutKey })
    if (!profile || !connected || !repositoryId || checkout === 'main') return
    const fail = (cause: unknown) => {
      if (current)
        setCheckoutOptions({
          key: checkoutKey,
          error: cause instanceof Error ? cause.message : String(cause),
        })
    }
    if (checkout === 'worktree') {
      void readRuntime(profile, '/api/scm/branches', { repositoryId }, branchesSchema, 'POST')
        .then((branches) => {
          if (!current) return
          setCheckoutOptions({ key: checkoutKey, branches })
          setWorktreeBaseBranch(
            branches.branches.find(
              (branch) => branch.name === branches.current || branch.ref === branches.current,
            )?.ref ??
              branches.branches[0]?.ref ??
              '',
          )
        })
        .catch(fail)
    } else {
      void readRuntime(
        profile,
        '/api/scm/worktrees/choices',
        { repositoryId },
        worktreeChoicesSchema,
        'POST',
      )
        .then((worktrees) => {
          if (!current) return
          setCheckoutOptions({ key: checkoutKey, worktrees })
          setExistingWorktreePath(worktrees.worktrees[0]?.path ?? '')
        })
        .catch(fail)
    }
    return () => {
      current = false
    }
  }, [checkoutKey, connected, checkoutRetry, readRuntime])
  const shells = catalog.ownerId === runtimeId ? catalog.data?.shells : undefined
  const options = checkoutOptions.key === checkoutKey ? checkoutOptions : undefined
  const shellReady = !!shells?.some((shell) => shell.id === shellId)
  const checkoutReady =
    !repositoryId ||
    checkout === 'main' ||
    (checkout === 'worktree'
      ? !!options?.branches?.branches.some((branch) => branch.ref === worktreeBaseBranch)
      : !!options?.worktrees?.worktrees.some((tree) => tree.path === existingWorktreePath))
  const resetCheckout = () => {
    setCheckout('main')
    setExistingWorktreePath('')
    setWorktreeBaseBranch('')
    setError('')
  }
  const pickerClass = 'h-7 max-w-full border-0 bg-transparent text-xs shadow-none'
  return (
    <div className="startup-draft w-full min-w-0 text-left">
      <div
        role="group"
        aria-label="Start a terminal"
        className="mb-6 mt-1 flex max-w-full flex-wrap items-center justify-center gap-1.5"
      >
        <button
          type="button"
          aria-label="Start in home folder"
          aria-pressed={!repositoryId}
          disabled={busy || !connected}
          onClick={() => {
            setRepositoryId('')
            resetCheckout()
          }}
          className={cn(
            'startup-no-project inline-flex min-h-11 min-w-20 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
            !repositoryId ? 'border-primary bg-primary/5' : 'border-border bg-card',
          )}
        >
          <House className="size-4" aria-hidden="true" /> Home folder
        </button>
        <div
          data-selected={!!repositoryId || undefined}
          className={cn(
            'startup-project-selector flex min-w-0 max-w-full items-center gap-1 rounded-lg border pl-3',
            repositoryId ? 'border-primary bg-primary/5' : 'border-border bg-card',
          )}
        >
          <Folder className="size-4 shrink-0" aria-hidden="true" />
          <ChoicePicker
            aria-label="Terminal working directory"
            className="h-9 max-w-full border-0 bg-transparent text-sm shadow-none"
            value={repositoryId}
            disabled={busy || !connected}
            onValueChange={(id) => {
              setRepositoryId(id)
              resetCheckout()
            }}
          >
            <option value="">Choose project</option>
            {owner?.snapshot?.workspace.repositories
              .filter((repo) => repo.kind !== 'scratch')
              .map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
          </ChoicePicker>
        </div>
      </div>
      <div
        className="task-composer"
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setEditorFocused(false)
        }}
      >
        <ComposerSurface
          aria-label="New workspace terminal"
          compact={!!minimalComposer && !editorFocused && !command.trim()}
          aria-busy={busy}
          error={error}
          controls={
            <ChoicePicker
              aria-label="Terminal shell"
              className={pickerClass}
              value={shellId}
              disabled={busy || !connected || !shells}
              onValueChange={setShellId}
            >
              {!shells && <option value="default">Default shell</option>}
              {shells?.map((shell) => (
                <option key={shell.id} value={shell.id}>
                  {shell.label}
                </option>
              ))}
            </ChoicePicker>
          }
          actions={
            <ComposerSubmit
              aria-label="Open terminal"
              title="Open terminal"
              busy={busy}
              disabled={busy || !connected || !shellReady || !checkoutReady}
            />
          }
          onSubmit={(event) => {
            event.preventDefault()
            if (!profile || !connected || busy || !shellReady || !checkoutReady) return
            const generation = ++attempt.current
            const input: CreateWorkspaceTerminal = {
              repositoryId: repositoryId || undefined,
              command: command.trim() ? command : undefined,
              shellId,
              execution: repositoryId ? (checkout === 'main' ? 'main' : 'worktree') : undefined,
              existingWorktreePath:
                repositoryId && checkout === 'existing' ? existingWorktreePath : undefined,
              worktreeBaseBranch:
                repositoryId && checkout === 'worktree' ? worktreeBaseBranch : undefined,
            }
            setBusy(true)
            setError('')
            void readRuntime(profile, '/api/terminals/workspace', input, responses.terminal, 'POST')
              .then((session) => {
                if (generation === attempt.current) onOpen({ runtimeId, id: session.id })
              })
              .catch((cause: unknown) => {
                if (generation === attempt.current)
                  setError(cause instanceof Error ? cause.message : String(cause))
              })
              .finally(() => {
                if (generation === attempt.current) setBusy(false)
              })
          }}
        >
          <ComposerTextarea
            aria-label="Startup command"
            preview={false}
            placeholder="Run a command, or open a shell…"
            maxLength={20000}
            value={command}
            disabled={busy}
            onFocus={() => setEditorFocused(true)}
            onChange={(event) => setCommand(event.target.value)}
          />
        </ComposerSurface>
        <ComposerWorkspaceBar>
          <ChoicePicker
            aria-label="Terminal computer"
            className={pickerClass}
            value={runtimeId}
            disabled={busy}
            onValueChange={(id) => {
              attempt.current++
              setRuntimeId(id)
              setRepositoryId('')
              setShellId('default')
              resetCheckout()
            }}
          >
            {!computers.length && <option value="">No paired computers</option>}
            {computers.map((entry) => (
              <option key={entry.profile.id} value={entry.profile.id}>
                {runtimeComputerName(entry)}
                {entry.connected ? '' : ' · offline'}
              </option>
            ))}
          </ChoicePicker>
          {repositoryId && (
            <ChoicePicker
              aria-label="Terminal checkout"
              className={pickerClass}
              value={checkout}
              disabled={busy || !connected}
              onValueChange={(value) => {
                if (value !== 'main' && value !== 'existing' && value !== 'worktree') return
                setCheckout(value)
                setExistingWorktreePath('')
                setWorktreeBaseBranch('')
                setError('')
              }}
            >
              <option value="main">Local checkout</option>
              <option value="existing">Existing worktree</option>
              <option value="worktree">New worktree</option>
            </ChoicePicker>
          )}
          {repositoryId && checkout === 'worktree' && options?.branches && (
            <ChoicePicker
              aria-label="Terminal base branch"
              className={pickerClass}
              value={worktreeBaseBranch}
              disabled={busy || !connected}
              onValueChange={setWorktreeBaseBranch}
            >
              {!options.branches.branches.length && <option value="">No branches available</option>}
              {options.branches.branches.map((branch) => (
                <option key={branch.ref} value={branch.ref}>
                  {branch.name}
                </option>
              ))}
            </ChoicePicker>
          )}
          {repositoryId && checkout === 'existing' && options?.worktrees && (
            <ChoicePicker
              aria-label="Terminal existing worktree"
              className={pickerClass}
              value={existingWorktreePath}
              disabled={busy || !connected}
              onValueChange={setExistingWorktreePath}
            >
              {!options.worktrees.worktrees.length && (
                <option value="">No existing worktrees</option>
              )}
              {options.worktrees.worktrees.map((tree) => (
                <option key={tree.path} value={tree.path}>
                  {tree.branch || tree.path} · {tree.path}
                  {tree.dirty ? ' · modified' : ''}
                </option>
              ))}
            </ChoicePicker>
          )}
        </ComposerWorkspaceBar>
      </div>
      {!connected && (
        <p role="status" className="mt-3 px-3 text-xs text-muted-foreground">
          {owner
            ? 'Computer offline. Reconnect to open a terminal.'
            : 'Pair a computer to open a terminal.'}
        </p>
      )}
      {connected && !shells && !catalog.error && (
        <p role="status" className="mt-3 px-3 text-xs text-muted-foreground">
          Loading shells…
        </p>
      )}
      {connected && catalog.ownerId === runtimeId && catalog.error && (
        <div role="alert" className="mt-3 px-3 text-xs text-destructive">
          Could not load shells: {catalog.error}{' '}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShellRetry((value) => value + 1)}
          >
            Retry shells
          </Button>
        </div>
      )}
      {connected &&
        repositoryId &&
        checkout !== 'main' &&
        !options?.error &&
        !options?.branches &&
        !options?.worktrees && (
          <p role="status" className="mt-3 px-3 text-xs text-muted-foreground">
            Loading {checkout === 'worktree' ? 'branches' : 'worktrees'}…
          </p>
        )}
      {connected && options?.error && (
        <div role="alert" className="mt-3 px-3 text-xs text-destructive">
          Could not load checkout choices: {options.error}{' '}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCheckoutRetry((value) => value + 1)}
          >
            Retry checkout choices
          </Button>
        </div>
      )}
    </div>
  )
}
