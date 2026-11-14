import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Effect, Result, Schema } from 'effect'
import { useEffect, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
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
import { useApplicationState } from '../runtime/state/application-state'
import { mobileWorkflow, nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import {
  SettingsSearchField as SearchField,
  SettingsField as Field,
} from '../screens/settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { TerminalSession } from '../terminal/terminal-session'

const installationsResponseSchema = mutableStruct({
  installations: mutableArray(acpInstallationSchema),
})
const registryAgent: Agent = {
  id: 'registry',
  name: 'ACP registry',
  provider: 'acp',
  endpoint: '',
  model: '',
  instructions: '',
  permission: 'ask',
}
export function AcpRegistrySettings() {
  return <AcpRegistry agent={registryAgent} onChange={() => {}} management />
}
export function AcpRegistry({
  agent,
  onChange,
  management = false,
  showRegistry = true,
}: {
  agent: Agent
  onChange: (agent: Agent) => void
  management?: boolean
  showRegistry?: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { callEffect, connected } = useRuntime()
  const [catalog, setCatalog] = useApplicationState<AcpRegistryResponse | null>(null)
  const [installations, setInstallations] = useApplicationState<AcpInstallation[]>([])
  const [refresh, setRefresh] = useApplicationState(0)
  const [loading, setLoading] = useApplicationState(false)
  const [loadError, setLoadError] = useApplicationState('')
  const [search, setSearch] = useApplicationState('')
  const [managedId, setManagedId] = useApplicationState('')
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
            Effect.result,
          ),
          callEffect('/api/agents/acp/list', {}, installationsResponseSchema, 'POST').pipe(
            Effect.result,
          ),
        ])
        yield* nativeEffect(() => {
          if (!active) return
          if (Result.isSuccess(registry)) setCatalog(registry.success)
          else
            setLoadError(
              registry.failure instanceof Error
                ? registry.failure.message
                : String(registry.failure),
            )
          if (Result.isSuccess(installed)) setInstallations(installed.success.installations)
          else
            setLoadError(
              installed.failure instanceof Error
                ? installed.failure.message
                : String(installed.failure),
            )
          setLoading(false)
        })
      }).pipe(
        Effect.catch((cause) =>
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
    if (management) {
      setManagedId(id)
      return
    }
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
  const selected = installations.find(
    (item) => item.id === (management ? managedId : agent.acpInstallationId),
  )
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.text}>
        <InterfaceText>{'ACP agents'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        {management
          ? uiText(
              'Install and manage agents on this runtime. Installing does not create a custom agent.',
            )
          : uiText('Choose an installed agent or use your own ACP command.')}
      </Text>
      <Action
        secondary
        label={uiText('Refresh registry')}
        disabled={!connected || busy || loading}
        onPress={() => setRefresh((value) => value + 1)}
      />
      {!management && (
        <Choice
          label={uiText('ACP agent installation')}
          value={agent.acpInstallationId ?? '__custom__'}
          disabled={!connected || busy}
          items={[
            { id: '__custom__', name: uiText('Custom ACP command') },
            ...(agent.acpInstallationId && !selected
              ? [{ id: agent.acpInstallationId, name: uiText('Saved installation (not listed)') }]
              : []),
            ...installations.map((item) => ({
              id: item.id,
              name: `${item.name} · ${item.version}`,
            })),
          ]}
          onChange={selectInstallation}
        />
      )}
      {management && installations.length > 0 && (
        <Choice
          label={uiText('Manage installed ACP agent')}
          value={managedId}
          items={[
            { id: '', name: uiText('Choose an installed agent to manage') },
            ...installations.map((item) => ({
              id: item.id,
              name: `${item.name} · ${item.version}`,
            })),
          ]}
          onChange={setManagedId}
        />
      )}
      {selected && (
        <Action
          secondary
          label={
            selected.needsRepair
              ? uiText('Repair installation in this runtime')
              : uiText('Check installation / update')
          }
          disabled={!connected || busy}
          onPress={() =>
            act(() =>
              mobileWorkflow(function* () {
                yield* callEffect(
                  '/api/agents/acp/install',
                  { registryId: selected.registryId },
                  acpInstallationSchema,
                  'POST',
                )
                yield* nativeEffect(() => setRefresh((value) => value + 1))
              }),
            )
          }
        />
      )}
      {selected?.needsRepair && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Repair the installation’s old folder before signing in. Existing threads keep their agent.'
            }
          </InterfaceText>
        </Text>
      )}
      {selected && !selected.needsRepair && (
        <AcpAuthentication
          key={`${selected.id}:${selected.installedAt}`}
          installation={selected}
          agent={agent}
        />
      )}
      {showRegistry && (
        <View style={{ gap: 8 }}>
          <Action
            secondary
            label={
              browseOpen
                ? uiText('Hide registry')
                : uiText('Browse registry{value0}', {
                    value0: catalog ? ` · ${catalog.agents.length}` : '',
                  })
            }
            disabled={!connected}
            onPress={() => setBrowseOpen((value) => !value)}
          />
          {browseOpen && (
            <>
              <SearchField
                label={uiText('Search ACP registry')}
                value={search}
                onChangeText={setSearch}
                placeholder={uiText('Search agents…')}
              />
              {loading && (
                <Text style={styles.muted}>
                  <InterfaceText>{'Loading registered agents…'}</InterfaceText>
                </Text>
              )}
              {!!loadError && <Text style={styles.error}>{loadError}</Text>}
              {!loading && catalog?.agents.length === 0 && (
                <Text style={styles.muted}>
                  <InterfaceText>{'No agents are available in this registry.'}</InterfaceText>
                </Text>
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
                          label={
                            management
                              ? uiText('Manage')
                              : agent.acpInstallationId === installed.id
                                ? uiText('Selected')
                                : uiText('Use')
                          }
                          disabled={busy || !connected}
                          onPress={() => selectInstallation(installed.id)}
                        />
                        <Action
                          destructive
                          secondary
                          label={uiText('Remove')}
                          disabled={busy || !connected}
                          onPress={() =>
                            Alert.alert(
                              uiText('Remove ACP agent?'),
                              uiText('Remove {value0} from the connected runtime?', {
                                value0: entry.name,
                              }),
                              [
                                { text: uiText('Cancel'), style: 'cancel' },
                                {
                                  text: uiText('Remove'),
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
                                          if (
                                            (management ? managedId : agent.acpInstallationId) ===
                                            installed.id
                                          )
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
                        label={
                          !entry.available
                            ? uiText('Unavailable')
                            : busy
                              ? uiText('Working…')
                              : uiText('Install')
                        }
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
      )}
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { callEffect, readEffect, connected } = useRuntime()
  const [methods, setMethods] = useApplicationState<Schema.Schema.Type<
    typeof acpInspectionSchema
  > | null>(null)
  const [terminal, setTerminal] = useApplicationState('')
  const [callbackUrl, setCallbackUrl] = useState('')
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
      readEffect('/api/agents/acp/inspect', { id: installation.id }, acpInspectionSchema, 'POST')
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
          Effect.catch((cause) =>
            nativeEffect(() => {
              if (active) setInspectError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
        ),
    )
    return () => {
      active = false
    }
  }, [readEffect, connected, installation.id])
  const waiting = methods?.authentication?.status === 'waiting'
  useEffect(() => {
    if (!connected || !waiting) return
    let active = true
    const poll = async () => {
      await runClientEffect(
        readEffect(
          '/api/agents/acp/inspect',
          { id: installation.id },
          acpInspectionSchema,
          'POST',
        ).pipe(
          Effect.flatMap((value) =>
            nativeEffect(() => {
              if (active) setMethods(value)
            }),
          ),
          Effect.catch((cause) =>
            nativeEffect(() => {
              if (active) setInspectError(String(cause))
            }),
          ),
        ),
      )
      if (active) timer = setTimeout(() => void poll(), 1500)
    }
    let timer = setTimeout(() => void poll(), 500)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [readEffect, connected, installation.id, waiting])
  const run = (methodId: string) =>
    act(() =>
      mobileWorkflow(function* () {
        if (methodId === 'logout')
          yield* callEffect('/api/agents/acp/logout', { id: installation.id }, responses.ok, 'POST')
        else {
          const result = yield* callEffect(
            '/api/agents/acp/authenticate',
            {
              id: installation.id,
              methodId,
              background:
                methods?.authMethods.find((method) => method.id === methodId)?.type !== 'terminal',
            },
            acpAuthenticationSchema,
            'POST',
          )
          yield* nativeEffect(() => setTerminal(result.terminal?.id ?? ''))
        }
        const status = yield* readEffect(
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
              ? uiText('Sign-out request completed.')
              : terminalIssued
                ? uiText('Complete sign-in in the terminal, then check the connection.')
                : uiText('Sign-in started. Follow the instructions below.'),
          )
        })
      }),
    )
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.muted}>
        <InterfaceText>{'Authentication'}</InterfaceText>
      </Text>
      <Action
        secondary
        label={uiText('Refresh sign-in status')}
        disabled={!connected || busy}
        onPress={() =>
          act(() =>
            readEffect(
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
      {methods?.authentication && (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>
            {waiting
              ? uiText('Waiting for sign-in…')
              : methods.authentication.status === 'completed'
                ? uiText('Sign-in completed. Check the connection to verify access.')
                : methods.authentication.error}
          </Text>
          {methods.authentication.urls.map((url) => (
            <Action
              key={url}
              secondary
              label={uiText('Open sign-in in browser · {value0}', {
                value0: new URL(url).hostname,
              })}
              onPress={() => act(() => nativeEffect(() => Linking.openURL(url)))}
            />
          ))}
          {!!methods.authentication.output && (
            <Text selectable style={styles.muted}>
              {methods.authentication.output}
            </Text>
          )}
          {waiting && (
            <Action
              secondary
              label={uiText('Cancel sign-in')}
              onPress={() =>
                act(() =>
                  mobileWorkflow(function* () {
                    yield* callEffect(
                      '/api/agents/acp/authenticate/cancel',
                      { id: installation.id },
                      responses.ok,
                      'POST',
                    )
                  }),
                )
              }
            />
          )}
          {waiting &&
            methods.authentication.urls.some((url) =>
              new URL(url).searchParams.has('redirect_uri'),
            ) && (
              <View style={{ gap: 6 }}>
                <Text style={styles.muted}>
                  <InterfaceText>
                    {
                      'If the browser returns to an unreachable localhost page, copy its full address here to finish sign-in on this server.'
                    }
                  </InterfaceText>
                </Text>
                <Field
                  label={uiText('Browser sign-in callback URL')}
                  value={callbackUrl}
                  onChangeText={setCallbackUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Action
                  secondary
                  label={uiText('Complete remote sign-in')}
                  disabled={!callbackUrl.trim() || busy}
                  onPress={() =>
                    act(() =>
                      mobileWorkflow(function* () {
                        yield* callEffect(
                          '/api/agents/acp/authenticate/callback',
                          { id: installation.id, url: callbackUrl.trim() },
                          responses.ok,
                          'POST',
                        )
                        yield* nativeEffect(() => setCallbackUrl(''))
                      }),
                    )
                  }
                />
              </View>
            )}
        </View>
      )}
      {methods?.authMethods.map((method) => (
        <View key={method.id} style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.muted}>{method.name}</Text>
            {!!method.description && <Text style={styles.muted}>{method.description}</Text>}
          </View>
          <Action
            secondary
            label={
              busy
                ? uiText('Waiting…')
                : method.type === 'terminal'
                  ? uiText('Open terminal')
                  : uiText('Sign in')
            }
            disabled={!connected || busy || !!terminal}
            onPress={() => run(method.id)}
          />
        </View>
      ))}
      {methods?.canLogout && (
        <Action
          secondary
          label={uiText('Sign out')}
          disabled={!connected || busy || !!terminal}
          onPress={() => run('logout')}
        />
      )}
      {!!inspectError && <Text style={styles.error}>{inspectError}</Text>}
      <Action
        secondary
        label={sessionsOpen ? uiText('Refresh agent sessions') : uiText('Load agent sessions')}
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
          <Text style={styles.muted}>
            <InterfaceText>{'Agent sessions on this runtime'}</InterfaceText>
          </Text>
          {sessions.sessions.map((session) => (
            <View key={session.sessionId} style={[styles.card, { gap: 4 }]}>
              <Text style={styles.text}>{session.title || session.sessionId}</Text>
              <Text numberOfLines={2} style={styles.muted}>
                {session.cwd}
              </Text>
              {sessions.canDelete && (
                <Action
                  destructive
                  secondary
                  label={uiText('Delete session')}
                  disabled={!connected || busy}
                  onPress={() =>
                    Alert.alert(
                      uiText('Delete agent session?'),
                      uiText('This permanently removes the agent’s saved session context.'),
                      [
                        { text: uiText('Cancel'), style: 'cancel' },
                        {
                          text: uiText('Delete'),
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
              label={uiText('Load more sessions')}
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
            <InterfaceText>
              {'Complete sign-in in the terminal, then check the connection.'}
            </InterfaceText>
          </Text>
          <Action
            secondary
            label={uiText('Stop sign-in terminal')}
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
          label={busy ? uiText('Checking connection…') : uiText('Check connection')}
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
                  setNotice(
                    uiText('Connection check succeeded · {value0} model choices.', {
                      value0: catalog.models.length,
                    }),
                  ),
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
