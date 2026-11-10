import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Folder, House, Terminal } from 'lucide-react'
import { Schema } from 'effect'
import {
  terminalShellsResponseSchema,
  runtimeComputerName,
  type CreateWorkspaceTerminal,
  type RuntimeOverview,
} from '@dovo/protocol'
import { StartupHeading } from '../task-creation/startup-heading'
import { TerminalCheckoutControls, useTerminalCheckout } from './terminal-checkout'
import { TerminalRecoveryControl } from './terminal-recovery-control'
import { responses, useAppPreferences, useWorkspace } from '@dovo/studio-core'
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

export function TerminalStarter({
  computers,
  onOpen,
}: {
  computers: readonly RuntimeOverview[]
  onOpen: (target: { runtimeId: string; id: string }) => void
}) {
  const store = useWorkspace()
  const commandField = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    commandField.current?.focus()
  }, [])
  const { minimalComposer } = useAppPreferences()
  const [editorFocused, setEditorFocused] = useState(false)
  const [runtimeId, setRuntimeId] = useState(
    store.activeRuntimeId ?? computers[0]?.profile.id ?? '',
  )
  const [repositoryId, setRepositoryId] = useState('')
  const [command, setCommand] = useState('')
  const [shellId, setShellId] = useState('default')
  const [rememberSession, setRememberSession] = useState(true)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ runtimeId: string; id: string }>()
  const [error, setError] = useState('')
  const [shellRetry, setShellRetry] = useState(0)
  const [catalog, setCatalog] = useState<{
    ownerId: string
    data?: Schema.Schema.Type<typeof terminalShellsResponseSchema>
    error?: string
  }>({ ownerId: '' })
  const owner = computers.find((entry) => entry.profile.id === runtimeId)
  const profile = owner?.profile
  const connected = owner?.connected ?? false
  const checkout = useTerminalCheckout({ owner, repositoryId })
  const readRuntime = store.readRuntime
  const attempt = useRef(0)
  // Activity pauses effects while hidden. Keep the result and open it only when this
  // starter is visible again, without losing a completed launch or stealing navigation.
  useEffect(() => {
    if (created) onOpen(created)
  }, [created, onOpen])
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
  const shells = catalog.ownerId === runtimeId ? catalog.data?.shells : undefined
  const shellReady = !!shells?.some((shell) => shell.id === shellId)
  const pickerClass = 'h-7 w-auto max-w-full border-0 bg-transparent text-xs shadow-none'
  return (
    <div className="startup-draft flex h-full min-h-0 w-full flex-col overflow-y-auto text-left">
      <StartupHeading description="Choose a folder and shell. Add a command, or open an empty shell.">
        <div
          role="group"
          aria-label="Start a terminal"
          className="flex max-w-full flex-wrap items-center justify-center gap-1.5"
        >
          <button
            type="button"
            aria-label="Start in home folder"
            aria-pressed={!repositoryId}
            disabled={busy || !connected}
            onClick={() => {
              setRepositoryId('')
              setError('')
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
              'startup-project-selector inline-flex min-w-0 max-w-full items-stretch',
              repositoryId ? 'border-primary bg-primary/5' : 'border-border bg-card',
            )}
          >
            <ChoicePicker
              aria-label="Terminal working directory"
              icons={Object.fromEntries([
                ['', <Folder className="size-4" />],
                ...(owner?.snapshot?.workspace.repositories ?? []).map((repo) => [
                  repo.id,
                  <ProjectIcon repository={repo} className="size-4" />,
                ]),
              ])}
              className="h-9 w-auto max-w-full border-0 bg-transparent text-sm shadow-none"
              value={repositoryId}
              disabled={busy || !connected}
              onValueChange={(id) => {
                setRepositoryId(id)
                setError('')
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
      </StartupHeading>
      <div className="mb-auto w-full shrink-0 pb-8">
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
                icons={Object.fromEntries(
                  (shells ?? []).map((shell) => [shell.id, <Terminal className="size-3.5" />]),
                )}
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
                disabled={busy || !connected || !shellReady || !checkout.ready}
              />
            }
            onSubmit={(event) => {
              event.preventDefault()
              if (!profile || !connected || busy || !shellReady || !checkout.ready) return
              const generation = ++attempt.current
              const input: CreateWorkspaceTerminal = {
                rememberSession:
                  rememberSession && owner?.snapshot?.terminalRecoverySupported === true,
                repositoryId: repositoryId || undefined,
                command: command.trim() ? command : undefined,
                shellId,
                ...checkout.input,
              }
              setBusy(true)
              setError('')
              void readRuntime(
                profile,
                '/api/terminals/workspace',
                input,
                responses.terminal,
                'POST',
              )
                .then((session) => {
                  if (generation === attempt.current) setCreated({ runtimeId, id: session.id })
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
              ref={commandField}
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
            <TerminalRecoveryControl
              enabled={rememberSession}
              supported={owner?.snapshot?.terminalRecoverySupported === true}
              disabled={busy}
              onChange={setRememberSession}
            />
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
                setError('')
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
            <TerminalCheckoutControls checkout={checkout} disabled={busy || !connected} />
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
      </div>
    </div>
  )
}
