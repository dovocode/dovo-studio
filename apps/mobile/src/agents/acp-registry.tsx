import { Effect, Either, Schema } from 'effect'
import { useEffect } from 'react'
import { Alert, View } from 'react-native'
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
import { useApplicationState } from '../runtime/application-state'
import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { SearchField } from '../ui/field'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { TerminalSession } from '../terminal/terminal-session'

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
  const { callEffect, connected } = useRuntime()
  const [catalog, setCatalog] = useApplicationState<AcpRegistryResponse | null>(null)
  const [installations, setInstallations] = useApplicationState<AcpInstallation[]>([])
  const [refresh, setRefresh] = useApplicationState(0)
  const [loading, setLoading] = useApplicationState(false)
  const [loadError, setLoadError] = useApplicationState('')
  const [search, setSearch] = useApplicationState('')
  const [browseOpen, setBrowseOpen] = useApplicationState(
    () => !agent.acpInstallationId && !agent.endpoint.trim(),
  )
  const { busy, error, act } = useAction()

  useEffect(() => {
    let active = true
    if (!connected) return
    setLoading(true)
    setLoadError('')
    void runClientEffect(
      mobileWorkflow(function* () {
        const [registry, installed] = yield* Effect.all([
          callEffect('/api/agents/acp/registry', {}, acpRegistryResponseSchema, 'POST').pipe(
            Effect.either,
          ),
          callEffect('/api/agents/acp/list', {}, installationsResponseSchema, 'POST').pipe(
            Effect.either,
          ),
        ])
        yield* nativeEffect(() => {
          if (!active) return
          if (Either.isRight(registry)) setCatalog(registry.right)
          else
            setLoadError(
              registry.left instanceof Error ? registry.left.message : String(registry.left),
            )
          if (Either.isRight(installed)) setInstallations(installed.right.installations)
          else
            setLoadError(
              installed.left instanceof Error ? installed.left.message : String(installed.left),
            )
          setLoading(false)
        })
      }).pipe(
        Effect.catchAll((cause) =>
          nativeEffect(() => {
            if (!active) return
            setLoadError(cause instanceof Error ? cause.message : String(cause))
            setLoading(false)
          }),
        ),
      ),
    )
    return () => {
      active = false
    }
  }, [callEffect, connected, refresh])

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
  const selected = installations.find((item) => item.id === agent.acpInstallationId)
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.text}>ACP agents</Text>
      <Text style={styles.muted}>
        Browse installs available on this connected runtime, or keep using your own ACP command.
      </Text>
      <Action
        secondary
        label="Refresh registry"
        disabled={!connected || busy || loading}
        onPress={() => setRefresh((value) => value + 1)}
      />
      <Choice
        label="ACP agent installation"
        value={agent.acpInstallationId ?? '__custom__'}
        disabled={!connected || busy}
        items={[
          { id: '__custom__', name: 'Custom ACP command' },
          ...(agent.acpInstallationId && !selected
            ? [{ id: agent.acpInstallationId, name: 'Saved installation (not listed)' }]
            : []),
          ...installations.map((item) => ({
            id: item.id,
            name: `${item.name} · ${item.version}`,
          })),
        ]}
        onChange={selectInstallation}
      />
      {selected && <AcpAuthentication key={selected.id} installation={selected} agent={agent} />}
      <View style={{ gap: 8 }}>
        <Action
          secondary
          label={
            browseOpen
              ? 'Hide registry'
              : `Browse registry${catalog ? ` · ${catalog.agents.length}` : ''}`
          }
          disabled={!connected}
          onPress={() => setBrowseOpen((value) => !value)}
        />
        {browseOpen && (
          <>
            <SearchField
              label="Search ACP registry"
              value={search}
              onChangeText={setSearch}
              placeholder="Search agents…"
            />
            {loading && <Text style={styles.muted}>Loading registered agents…</Text>}
            {!!loadError && <Text style={styles.error}>{loadError}</Text>}
            {!loading && catalog?.agents.length === 0 && (
              <Text style={styles.muted}>No agents are available in this registry.</Text>
            )}
            {catalog?.agents.map((entry) => {
              if (
                !entry.name.toLowerCase().includes(search.toLowerCase()) &&
                !entry.description.toLowerCase().includes(search.toLowerCase())
              )
                return null
              const installed = installations.find((item) => item.registryId === entry.id)
              return (
                <View key={entry.id} style={[styles.card, { gap: 6 }]}>
                  <Text style={styles.text}>{entry.name}</Text>
                  <Text style={styles.muted}>
                    {entry.version} · {entry.distribution}
                  </Text>
                  <Text style={styles.muted}>{entry.description}</Text>
                  {installed ? (
                    <View style={styles.row}>
                      <Action
                        secondary
                        label={agent.acpInstallationId === installed.id ? 'Selected' : 'Use'}
                        disabled={busy || !connected}
                        onPress={() => selectInstallation(installed.id)}
                      />
                      <Action
                        secondary
                        label="Remove"
                        disabled={busy || !connected}
                        onPress={() =>
                          Alert.alert(
                            'Remove ACP agent?',
                            `Remove ${entry.name} from the connected runtime?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove',
                                style: 'destructive',
                                onPress: () =>
                                  act(() =>
                                    mobileWorkflow(function* () {
                                      yield* callEffect(
                                        '/api/agents/acp/remove',
                                        { id: installed.id },
                                        responses.ok,
                                        'POST',
                                      )
                                      yield* nativeEffect(() => {
                                        if (agent.acpInstallationId === installed.id)
                                          selectInstallation('__custom__')
                                        setRefresh((value) => value + 1)
                                      })
                                    }),
                                  ),
                              },
                            ],
                          )
                        }
                      />
                    </View>
                  ) : (
                    <Action
                      secondary
                      label={!entry.available ? 'Unavailable' : busy ? 'Working…' : 'Install'}
                      disabled={busy || !connected || !entry.available}
                      onPress={() =>
                        act(() =>
                          mobileWorkflow(function* () {
                            const installed = yield* callEffect(
                              '/api/agents/acp/install',
                              { registryId: entry.id },
                              acpInstallationSchema,
                              'POST',
                            )
                            yield* nativeEffect(() => {
                              setRefresh((value) => value + 1)
                              selectInstallation(installed.id)
                            })
                          }),
                        )
                      }
                    />
                  )}
                </View>
              )
            })}
          </>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  )
}

function AcpAuthentication({
  installation,
  agent,
}: {
  installation: AcpInstallation
  agent: Agent
}) {
  const { callEffect, connected } = useRuntime()
  const [methods, setMethods] = useApplicationState<Schema.Schema.Type<
    typeof acpInspectionSchema
  > | null>(null)
  const [terminal, setTerminal] = useApplicationState('')
  const [notice, setNotice] = useApplicationState('')
  const [inspectError, setInspectError] = useApplicationState('')
  const [sessionsOpen, setSessionsOpen] = useApplicationState(false)
  const [sessions, setSessions] = useApplicationState<Schema.Schema.Type<
    typeof acpSessionsSchema
  > | null>(null)
  const { busy, error, act } = useAction()
  useEffect(() => {
    if (!connected) return
    let active = true
    setMethods(null)
    setNotice('')
    setInspectError('')
    void runClientEffect(
      callEffect('/api/agents/acp/inspect', { id: installation.id }, acpInspectionSchema, 'POST')
        .pipe(
          Effect.flatMap((value) =>
            nativeEffect(() => {
              if (active) {
                setMethods(value)
                setTerminal(value.terminal?.id ?? '')
              }
            }),
          ),
        )
        .pipe(
          Effect.catchAll((cause) =>
            nativeEffect(() => {
              if (active) setInspectError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
        ),
    )
    return () => {
      active = false
    }
  }, [callEffect, connected, installation.id])
  const run = (methodId: string) =>
    act(() =>
      mobileWorkflow(function* () {
        if (methodId === 'logout')
          yield* callEffect('/api/agents/acp/logout', { id: installation.id }, responses.ok, 'POST')
        else {
          const result = yield* callEffect(
            '/api/agents/acp/authenticate',
            { id: installation.id, methodId },
            acpAuthenticationSchema,
            'POST',
          )
          yield* nativeEffect(() => setTerminal(result.terminal?.id ?? ''))
        }
        const status = yield* callEffect(
          '/api/agents/acp/inspect',
          { id: installation.id },
          acpInspectionSchema,
          'POST',
        )
        const terminalIssued = methodId !== 'logout' && status.terminal !== undefined
        yield* nativeEffect(() => {
          setMethods(status)
          setTerminal(status.terminal?.id ?? '')
          setNotice(
            methodId === 'logout'
              ? 'Sign-out request completed.'
              : terminalIssued
                ? 'Complete sign-in in the terminal, then check the connection.'
                : 'Sign-in request completed.',
          )
        })
      }),
    )
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.muted}>Authentication</Text>
      <Action
        secondary
        label="Refresh sign-in status"
        disabled={!connected || busy}
        onPress={() =>
          act(() =>
            callEffect(
              '/api/agents/acp/inspect',
              { id: installation.id },
              acpInspectionSchema,
              'POST',
            ).pipe(
              Effect.flatMap((value) =>
                nativeEffect(() => {
                  setMethods(value)
                  setTerminal(value.terminal?.id ?? '')
                  setInspectError('')
                }),
              ),
            ),
          )
        }
      />
      {methods?.authMethods.map((method) => (
        <View key={method.id} style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.muted}>{method.name}</Text>
            {!!method.description && <Text style={styles.muted}>{method.description}</Text>}
          </View>
          <Action
            secondary
            label={busy ? 'Waiting…' : method.type === 'terminal' ? 'Open terminal' : 'Sign in'}
            disabled={!connected || busy || !!terminal}
            onPress={() => run(method.id)}
          />
        </View>
      ))}
      {methods?.canLogout && (
        <Action
          secondary
          label="Sign out"
          disabled={!connected || busy || !!terminal}
          onPress={() => run('logout')}
        />
      )}
      {!!inspectError && <Text style={styles.error}>{inspectError}</Text>}
      <Action
        secondary
        label={sessionsOpen ? 'Refresh agent sessions' : 'Load agent sessions'}
        disabled={!connected || busy}
        onPress={() => {
          setSessionsOpen(true)
          act(() =>
            mobileWorkflow(function* () {
              const value = yield* callEffect(
                '/api/agents/acp/sessions',
                { id: installation.id },
                acpSessionsSchema,
                'POST',
              )
              yield* nativeEffect(() => setSessions(value))
            }),
          )
        }}
      />
      {sessionsOpen && sessions && (
        <View style={{ gap: 8 }}>
          <Text style={styles.muted}>Agent sessions on this runtime</Text>
          {sessions.sessions.map((session) => (
            <View key={session.sessionId} style={[styles.card, { gap: 4 }]}>
              <Text style={styles.text}>{session.title || session.sessionId}</Text>
              <Text numberOfLines={2} style={styles.muted}>
                {session.cwd}
              </Text>
              {sessions.canDelete && (
                <Action
                  secondary
                  label="Delete session"
                  disabled={!connected || busy}
                  onPress={() =>
                    Alert.alert(
                      'Delete agent session?',
                      'This permanently removes the agent’s saved session context.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () =>
                            act(() =>
                              mobileWorkflow(function* () {
                                yield* callEffect(
                                  '/api/agents/acp/sessions/delete',
                                  { id: installation.id, sessionId: session.sessionId },
                                  responses.ok,
                                  'POST',
                                )
                                const value = yield* callEffect(
                                  '/api/agents/acp/sessions',
                                  { id: installation.id },
                                  acpSessionsSchema,
                                  'POST',
                                )
                                yield* nativeEffect(() => setSessions(value))
                              }),
                            ),
                        },
                      ],
                    )
                  }
                />
              )}
            </View>
          ))}
          {!!sessions.nextCursor && (
            <Action
              secondary
              label="Load more sessions"
              disabled={!connected || busy}
              onPress={() =>
                act(() =>
                  mobileWorkflow(function* () {
                    const value = yield* callEffect(
                      '/api/agents/acp/sessions',
                      { id: installation.id, cursor: sessions.nextCursor },
                      acpSessionsSchema,
                      'POST',
                    )
                    yield* nativeEffect(() =>
                      setSessions((current) =>
                        current
                          ? { ...value, sessions: [...current.sessions, ...value.sessions] }
                          : value,
                      ),
                    )
                  }),
                )
              }
            />
          )}
        </View>
      )}
      {!!terminal && (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>
            Complete sign-in in the terminal, then check the connection.
          </Text>
          <Action
            secondary
            label="Stop sign-in terminal"
            disabled={!connected || busy}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect('/api/terminals/close', { id: terminal }, responses.ok, 'POST')
                  yield* nativeEffect(() => setTerminal(''))
                }),
              )
            }
          />
          <View style={{ height: 280, minHeight: 280, overflow: 'hidden', borderRadius: 8 }}>
            <TerminalSession id={terminal} />
          </View>
        </View>
      )}
      {!terminal && (
        <Action
          secondary
          label={busy ? 'Checking connection…' : 'Check connection'}
          disabled={!connected || busy}
          onPress={() =>
            act(() =>
              mobileWorkflow(function* () {
                const catalog = yield* callEffect(
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
                yield* nativeEffect(() =>
                  setNotice(`Connection check succeeded · ${catalog.models.length} model choices.`),
                )
              }),
            )
          }
        />
      )}
      {!!notice && <Text style={styles.muted}>{notice}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
