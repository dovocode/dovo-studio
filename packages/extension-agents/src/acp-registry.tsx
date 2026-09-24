import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import {
  acpAuthenticationSchema,
  acpInspectionSchema,
  acpInstallationSchema,
  acpRegistryResponseSchema,
  acpSessionsSchema,
  modelCatalogSchema,
  mutableArray,
  mutableStruct,
  responses,
  type AcpInstallation,
  type AcpRegistryResponse,
  type Agent,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { useCallback, useEffect } from 'react'
import { TerminalSession } from '@dovo/extension-tasks/terminal-session'
import { Button, ChoicePicker, Input } from '@dovo/studio-ui'
import { Check, KeyRound, RefreshCw, Trash2 } from 'lucide-react'

const installationsResponseSchema = mutableStruct({
  installations: mutableArray(acpInstallationSchema),
})

export function AcpRegistry({
  agent,
  onChange,
}: {
  agent: Agent
  onChange: (agent: Agent) => void
}) {
  const { request, connected } = useWorkspace()
  const [catalog, setCatalog] = useApplicationState<AcpRegistryResponse | null>(null)
  const [installations, setInstallations] = useApplicationState<AcpInstallation[]>([])
  const [loading, setLoading] = useApplicationState(false)
  const [refresh, setRefresh] = useApplicationState(0)
  const [busyId, setBusyId] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [search, setSearch] = useApplicationState('')
  const [browseOpen, setBrowseOpen] = useApplicationState(
    () => !agent.acpInstallationId && !agent.endpoint.trim(),
  )

  useEffect(() => {
    if (!connected) return
    let active = true
    setLoading(true)
    setError('')
    void Promise.allSettled([
      request('/api/agents/acp/registry', {}, acpRegistryResponseSchema, 'POST'),
      request('/api/agents/acp/list', {}, installationsResponseSchema, 'POST'),
    ]).then(([registryResult, installedResult]) => {
      if (!active) return
      if (registryResult.status === 'fulfilled') setCatalog(registryResult.value)
      else setError(message(registryResult.reason))
      if (installedResult.status === 'fulfilled')
        setInstallations(installedResult.value.installations)
      else setError(message(installedResult.reason))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [connected, request, refresh])

  const selectInstallation = (id: string) => {
    const acpInstallationId = id === '__custom__' ? undefined : id || undefined
    if (acpInstallationId === agent.acpInstallationId) return
    onChange({
      ...agent,
      acpInstallationId,
      model: '',
      reasoning: '',
      acpMode: undefined,
      acpConfig: undefined,
    })
    setBrowseOpen(false)
  }
  const mutate = async <T,>(
    id: string,
    operation: () => Promise<T>,
    onSuccess?: (value: T) => void,
  ) => {
    setBusyId(id)
    setError('')
    try {
      const value = await operation()
      onSuccess?.(value)
      setRefresh((current) => current + 1)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusyId('')
    }
  }
  const selected = installations.find((item) => item.id === agent.acpInstallationId)
  const filtered = catalog?.agents.filter((entry) =>
    `${entry.id} ${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">ACP agents</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Install registered agents on the connected runtime or use a custom command.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh ACP registry"
          disabled={!connected || loading || !!busyId}
          onClick={() => setRefresh((current) => current + 1)}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      <ChoicePicker
        aria-label="ACP agent installation"
        className="h-9 rounded-md border bg-background px-2 text-xs"
        value={agent.acpInstallationId ?? '__custom__'}
        disabled={!connected || !!busyId}
        onValueChange={selectInstallation}
      >
        <option value="__custom__">Custom ACP command</option>
        {agent.acpInstallationId && !selected && (
          <option value={agent.acpInstallationId}>Saved installation (not listed)</option>
        )}
        {installations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.version}
          </option>
        ))}
      </ChoicePicker>
      {selected && (
        <AcpAuthentication
          key={selected.id}
          installation={selected}
          agent={agent}
          connected={connected}
          disabled={!connected || !!busyId}
          request={request}
        />
      )}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">Runtime registry</h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!connected}
            onClick={() => setBrowseOpen((value) => !value)}
          >
            {browseOpen
              ? 'Hide registry'
              : `Browse registry${catalog ? ` · ${catalog.agents.length}` : ''}`}
          </Button>
        </div>
        {browseOpen && (
          <>
            <Input
              aria-label="Search ACP registry"
              placeholder="Search agents…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {loading && <p className="text-xs text-muted-foreground">Loading registered agents…</p>}
            {!loading && filtered?.length === 0 && !error && (
              <p className="text-xs text-muted-foreground">
                {search
                  ? 'No agents match this search.'
                  : 'No agents are available in this registry.'}
              </p>
            )}
            {filtered?.map((entry) => {
              const installed = installations.find((item) => item.registryId === entry.id)
              const isBusy = busyId === entry.id || busyId === installed?.id
              return (
                <article key={entry.id} className="grid gap-2 rounded border bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h5 className="text-sm font-medium">{entry.name}</h5>
                      <p className="text-xs text-muted-foreground">
                        {entry.version} · {entry.distribution}
                      </p>
                    </div>
                    {installed ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant={
                            agent.acpInstallationId === installed.id ? 'secondary' : 'outline'
                          }
                          size="sm"
                          disabled={isBusy || !connected}
                          onClick={() => selectInstallation(installed.id)}
                        >
                          {agent.acpInstallationId === installed.id ? <Check size={13} /> : null}
                          {agent.acpInstallationId === installed.id ? 'Selected' : 'Use'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${entry.name}`}
                          disabled={isBusy || !connected}
                          onClick={() => {
                            if (!window.confirm(`Remove ${entry.name} from this runtime?`)) return
                            void mutate(
                              installed.id,
                              () =>
                                request(
                                  '/api/agents/acp/remove',
                                  { id: installed.id },
                                  responses.ok,
                                  'POST',
                                ),
                              () => {
                                if (agent.acpInstallationId === installed.id)
                                  selectInstallation('__custom__')
                              },
                            )
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy || !connected || !entry.available || !!busyId}
                        onClick={() =>
                          void mutate(
                            entry.id,
                            () =>
                              request(
                                '/api/agents/acp/install',
                                { registryId: entry.id },
                                acpInstallationSchema,
                                'POST',
                              ),
                            (value) => selectInstallation(value.id),
                          )
                        }
                      >
                        {isBusy ? 'Installing…' : entry.available ? 'Install' : 'Unavailable'}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{entry.description}</p>
                  {!entry.available && !installed && (
                    <p className="text-xs text-muted-foreground">Not available on this runtime.</p>
                  )}
                </article>
              )
            })}
          </>
        )}
      </div>
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

type Request = ReturnType<typeof useWorkspace>['request']
function AcpAuthentication({
  installation,
  agent,
  connected,
  disabled,
  request,
}: {
  installation: AcpInstallation
  agent: Agent
  connected: boolean
  disabled: boolean
  request: Request
}) {
  const [methods, setMethods] = useApplicationState<Schema.Schema.Type<
    typeof acpInspectionSchema
  > | null>(null)
  const [terminal, setTerminal] = useApplicationState<string | null>(null)
  const [busyId, setBusyId] = useApplicationState('')
  const [notice, setNotice] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [sessions, setSessions] = useApplicationState<Schema.Schema.Type<
    typeof acpSessionsSchema
  > | null>(null)
  const [sessionsBusy, setSessionsBusy] = useApplicationState(false)
  const [sessionsError, setSessionsError] = useApplicationState('')
  const refreshMethods = useCallback(async () => {
    const value = await request(
      '/api/agents/acp/inspect',
      { id: installation.id },
      acpInspectionSchema,
      'POST',
    )
    setMethods(value)
    setTerminal(value.terminal?.id ?? null)
  }, [installation.id, request])

  useEffect(() => {
    if (!connected) return
    let active = true
    void refreshMethods().catch((cause: unknown) => {
      if (active) setError(message(cause))
    })
    return () => {
      active = false
    }
  }, [connected, refreshMethods])

  const run = async (label: string, operation: () => Promise<unknown>) => {
    setBusyId(label)
    setNotice('')
    setError('')
    try {
      const value = await operation()
      const terminalIssued =
        typeof value === 'object' && value !== null && 'terminal' in value && value.terminal != null
      setNotice(
        label === 'logout'
          ? 'Sign-out request completed.'
          : terminalIssued
            ? 'Complete sign-in in the terminal, then check the connection.'
            : 'Sign-in request completed.',
      )
      await refreshMethods()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusyId('')
    }
  }
  const loadSessions = async (cursor?: string, append = false) => {
    setSessionsBusy(true)
    setSessionsError('')
    try {
      const value = await request(
        '/api/agents/acp/sessions',
        { id: installation.id, ...(cursor ? { cursor } : {}) },
        acpSessionsSchema,
        'POST',
      )
      setSessions((current) =>
        append && current
          ? { ...value, sessions: [...current.sessions, ...value.sessions] }
          : value,
      )
    } catch (cause) {
      setSessionsError(message(cause))
    } finally {
      setSessionsBusy(false)
    }
  }
  const deleteSession = async (sessionId: string) => {
    if (!window.confirm('Permanently delete this ACP session and its saved context?')) return
    setSessionsBusy(true)
    setSessionsError('')
    try {
      await request(
        '/api/agents/acp/sessions/delete',
        { id: installation.id, sessionId },
        responses.ok,
        'POST',
      )
      await loadSessions()
    } catch (cause) {
      setSessionsError(message(cause))
    } finally {
      setSessionsBusy(false)
    }
  }
  const closeTerminal = async () => {
    if (!terminal) return
    setBusyId('terminal')
    try {
      await request('/api/terminals/close', { id: terminal }, responses.ok, 'POST')
      setTerminal(null)
      setNotice('Sign-in terminal closed. Check whether authentication completed.')
      await refreshMethods()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusyId('')
    }
  }
  const checkConnection = async () => {
    setBusyId('probe')
    setError('')
    try {
      const catalog = await request(
        '/api/agents/models',
        {
          provider: 'acp',
          endpoint: agent.endpoint,
          args: agent.args,
          model: agent.model,
          acpInstallationId: installation.id,
          acpMode: agent.acpMode,
          acpConfig: agent.acpConfig,
        },
        modelCatalogSchema,
      )
      setNotice(`Connection check succeeded · ${catalog.models.length} model choices.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="grid gap-2 rounded border p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <KeyRound size={13} /> Authentication
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!connected || !!busyId}
        onClick={() => void refreshMethods().catch((cause: unknown) => setError(message(cause)))}
      >
        Refresh sign-in status
      </Button>
      {!methods && !error && (
        <p className="text-xs text-muted-foreground">Checking available sign-in methods…</p>
      )}
      {methods && methods.authMethods.length === 0 && !methods.terminal && (
        <p className="text-xs text-muted-foreground">No sign-in method is currently available.</p>
      )}
      {methods?.authMethods.map((method) => (
        <div key={method.id} className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-xs text-muted-foreground">
            {method.name}
            {method.description ? ` · ${method.description}` : ''}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !!busyId || !!terminal}
            onClick={() =>
              void run(method.id, () =>
                request(
                  '/api/agents/acp/authenticate',
                  { id: installation.id, methodId: method.id },
                  acpAuthenticationSchema,
                  'POST',
                ),
              )
            }
          >
            {busyId === method.id
              ? 'Waiting…'
              : method.type === 'terminal'
                ? 'Open terminal'
                : 'Sign in'}
          </Button>
        </div>
      ))}
      {methods?.canLogout && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !!busyId || !!terminal}
          onClick={() =>
            void run('logout', () =>
              request('/api/agents/acp/logout', { id: installation.id }, responses.ok, 'POST'),
            )
          }
        >
          Sign out
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || sessionsBusy}
        onClick={() => void loadSessions()}
      >
        {sessions ? 'Refresh' : 'Load'} agent sessions
      </Button>
      {sessions && (
        <div className="grid gap-2">
          {sessions.sessions.map((session) => (
            <div
              key={session.sessionId}
              className="flex items-start justify-between gap-3 rounded border p-2"
            >
              <div className="min-w-0">
                <p className="break-words text-xs font-medium">
                  {session.title || session.sessionId}
                </p>
                <p className="break-all text-xs text-muted-foreground">{session.cwd}</p>
              </div>
              {sessions.canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={sessionsBusy || disabled}
                  onClick={() => void deleteSession(session.sessionId)}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
          {!!sessions.nextCursor && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sessionsBusy || disabled}
              onClick={() => void loadSessions(sessions.nextCursor, true)}
            >
              Load more
            </Button>
          )}
        </div>
      )}
      {!!sessionsError && (
        <p role="alert" className="text-xs text-destructive">
          {sessionsError}
        </p>
      )}
      {!!terminal && (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Complete sign-in in the terminal, then check the connection.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !!busyId}
            onClick={() => void closeTerminal()}
          >
            Stop sign-in terminal
          </Button>
          <div className="flex h-64 min-h-0 overflow-hidden rounded border">
            <TerminalSession id={terminal} active />
          </div>
        </div>
      )}
      {!terminal && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !!busyId}
          onClick={() => void checkConnection()}
        >
          {busyId === 'probe' ? 'Checking…' : 'Check connection'}
        </Button>
      )}
      {!!notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
