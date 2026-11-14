import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  runtimeComputerName,
  parseAgentEnvironment,
  formatAgentEnvironment,
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReference,
} from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { CliProfilePicker } from './cli-profile-picker'
import { GithubConnectionStatus } from './github-connection-status'
import { SecretReferenceFields } from './secret-reference-fields'
import { useEffect, useRef } from 'react'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import { ScrollView, View } from 'react-native'
import { Schema, Effect } from 'effect'
import {
  forgeLabels,
  projectDisplayName,
  forgeProviderSchema,
  forgeConnectionSchema,
  forgeConnectionsSchema,
  forgeConnectionInputSchema,
  forgeRepositoryPageSchema,
  repositorySchema,
  type ForgeConnection,
  type ForgeProvider,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import {
  SettingsSheet as Sheet,
  SettingsPage,
  useSettingsTheme,
} from '../../screens/settings-theme'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { SettingsGroup, SettingsRow } from '../../screens/settings-group'
import { DirectoryPicker } from './directory-picker'
import { suggestedProjectName } from './project-name'
const defaults: Record<ForgeProvider, string> = {
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
  bitbucket: 'https://api.bitbucket.org/2.0',
  forgejo: 'https://codeberg.org',
  gitea: 'https://gitea.example.com',
  'azure-devops': 'https://dev.azure.com/organization',
}
const ok = mutableStruct({
  ok: Schema.Boolean,
})
export default function SourceControlSettings() {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()

  const { overviews } = useRuntime()
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Source control')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.muted}>
          <InterfaceText>
            {'Accounts and linked projects across your computers. Credentials stay on their host.'}
          </InterfaceText>
        </Text>
        {!overviews.length && (
          <Text style={styles.muted}>
            <InterfaceText>{'Connect a computer to manage source-control accounts.'}</InterfaceText>
          </Text>
        )}
        {overviews.map((entry) => (
          <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
            <View
              style={{
                gap: 12,
              }}
            >
              <Text style={styles.text}>
                {runtimeComputerName(entry)}
                {entry.connected ? '' : uiText(' · Offline')}
              </Text>
              <ConnectionsContent />
            </View>
          </RuntimeScope>
        ))}
      </ScrollView>
    </SettingsPage>
  )
}
function ConnectionsContent() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { read, connected, snapshot, readCache, callEffect, readEffect } = useRuntime()
  const [connections, setConnections] = useApplicationState<ForgeConnection[]>([]),
    [error, setError] = useApplicationState(''),
    [revision, setRevision] = useApplicationState(0)
  const [editing, setEditing] = useApplicationState<ForgeConnection | 'new' | null>(null),
    [project, setProject] = useApplicationState<string | null>(null)
  const [loading, setLoading] = useApplicationState(false)
  const projects = snapshot?.workspace.repositories.filter((repo) => !repo.kind) ?? []
  const automaticProjects = projects.filter((repo) => !repo.forge)
  useEffect(() => {
    let active = true
    let received = false
    setError('')
    setLoading(connected)
    if (readCache)
      void runClientEffect(
        readCache.readEffect('scm-connections', forgeConnectionsSchema).pipe(
          Effect.tap((cached) =>
            Effect.sync(() => {
              if (active && !received && cached) setConnections(cached.value.connections)
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              if (active) setError(uiText('Could not load saved accounts.'))
            }),
          ),
        ),
      )
    if (connected)
      void runClientEffect(
        readEffect('/api/scm/connections/read', {}, forgeConnectionsSchema)
          .pipe(
            Effect.flatMap((result) =>
              mobileWorkflow(function* () {
                received = true
                if (!active) return
                setConnections(result.connections)
                setError('')
                return yield* mobileWorkflow(function* () {
                  yield* (
                    readCache?.writeEffect('scm-connections', result) ?? Effect.succeed(undefined)
                  )
                }).pipe(
                  Effect.catch((_error) =>
                    nativeEffect(() => {
                      if (active)
                        setError(
                          uiText('Accounts loaded, but could not be saved for offline access.'),
                        )
                    }),
                  ),
                )
              }),
            ),
          )
          .pipe(
            Effect.catch((cause) =>
              nativeEffect(() => {
                if (active) setError(String(cause))
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (active) setLoading(false)
              }),
            ),
          ),
      )
    return () => {
      active = false
    }
  }, [read, revision, connected, readCache])
  const done = () => {
    setEditing(null)
    setProject(null)
    setRevision((value) => value + 1)
  }
  const remove = (connection: ForgeConnection) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        return yield* mobileWorkflow(function* () {
          yield* callEffect(
            '/api/scm/connections/remove',
            {
              id: connection.id,
              revision: connection.revision,
            },
            ok,
          )
          done()
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(String(cause))
            }),
          ),
        )
      }),
    )
  }
  return (
    <View
      style={{
        gap: 12,
      }}
    >
      <View
        style={{
          gap: 12,
        }}
      >
        {!connected && (
          <Text style={styles.muted}>
            <InterfaceText>
              {'Offline · Showing saved accounts. Reconnect this computer to make changes.'}
            </InterfaceText>
          </Text>
        )}
        {loading && (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            <InterfaceText>{'Loading accounts…'}</InterfaceText>
          </Text>
        )}
        <SettingsGroup title={uiText('Automatic GitHub CLI')}>
          <GithubConnectionStatus automatic key={`automatic:${revision}`} />
          <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 16 }]}>
            <InterfaceText
              values={{
                value0: automaticProjects.length,
                value1: automaticProjects.length
                  ? ` · ${automaticProjects.map((repo) => repo.name).join(', ')}`
                  : uiText(' · No projects yet'),
              }}
            >
              {'Projects using automatic detection ({value0}){value1}'}
            </InterfaceText>
          </Text>
        </SettingsGroup>
        <SettingsGroup title={uiText('Saved accounts')}>
          {!loading && !error && !connections.length && (
            <Text style={[styles.muted, { padding: 16 }]}>
              <InterfaceText>
                {'No saved accounts. Projects can use automatic GitHub CLI detection above.'}
              </InterfaceText>
            </Text>
          )}
          {connections.map((connection, index) => (
            <View key={`${connection.id}:${connection.revision}`}>
              <SettingsRow
                title={connection.name}
                subtitle={`${forgeLabels[connection.provider]} · ${connection.baseUrl}`}
                icon="changes"
                disabled={!connected}
                onPress={() => setEditing(connection)}
                last={index === connections.length - 1}
              />
              {connection.provider === 'github' && (
                <GithubConnectionStatus connectionId={connection.id} />
              )}
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 16 }]}>
                <InterfaceText
                  values={{
                    value0:
                      projects
                        .filter((repo) => repo.forge?.connectionId === connection.id)
                        .map((repo) => repo.name)
                        .join(', ') || uiText('None'),
                  }}
                >
                  {'Projects using this account · {value0}'}
                </InterfaceText>
              </Text>
            </View>
          ))}
        </SettingsGroup>
        <Action
          label={uiText('Connect account')}
          disabled={!connected}
          onPress={() => setEditing('new')}
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'GitHub projects already use the runtime’s GitHub CLI login. Add a connection to use a different GitHub user, wrapper selector, host or provider.'
            }
          </InterfaceText>
        </Text>
        <SettingsGroup title={uiText('Projects')}>
          {projects.map((repo, index) => (
            <View
              key={`${repo.id}:${repo.path}:${repo.forge?.connectionId ?? ''}:${repo.forge?.repository ?? ''}:${revision}`}
            >
              <SettingsRow
                title={projectDisplayName(repo)}
                subtitle={
                  repo.forge
                    ? `${connections.find((connection) => connection.id === repo.forge?.connectionId)?.name ?? uiText('Account')} · ${repo.forge.repository}`
                    : uiText('Automatic GitHub connection')
                }
                icon="folder"
                disabled={!connected}
                onPress={() => setProject(repo.id)}
                last={index === projects.length - 1}
              />
              {(!repo.forge ||
                connections.find((connection) => connection.id === repo.forge?.connectionId)
                  ?.provider === 'github') && (
                <GithubConnectionStatus
                  repositoryId={repo.id}
                  connectionId={repo.forge?.connectionId}
                />
              )}
            </View>
          ))}
        </SettingsGroup>
        <Action
          secondary
          label={uiText('Clone a project')}
          disabled={!connected || !connections.length}
          onPress={() => setProject('new')}
        />
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!!error && (
          <Action
            secondary
            label={uiText('Retry accounts')}
            disabled={!connected}
            onPress={() => setRevision((value) => value + 1)}
          />
        )}
      </View>
      {editing && (
        <ConnectionForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={done}
          onRemove={
            editing === 'new'
              ? undefined
              : () => {
                  const current = editing
                  setEditing(null)
                  void remove(current)
                }
          }
        />
      )}
      {project && (
        <ProjectConnection
          projectId={project}
          connections={connections}
          onClose={() => setProject(null)}
          onDone={done}
        />
      )}
    </View>
  )
}
function ConnectionForm({
  initial,
  onClose,
  onDone,
  onRemove,
}: {
  initial?: ForgeConnection
  onClose: () => void
  onDone: () => void
  onRemove?: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { connected, callEffect } = useRuntime()
  const [provider, setProvider] = useApplicationState<ForgeProvider>(initial?.provider ?? 'github'),
    [name, setName] = useApplicationState(initial?.name ?? 'GitHub'),
    [baseUrl, setBaseUrl] = useApplicationState(initial?.baseUrl ?? defaults.github)
  const [username, setUsername] = useApplicationState(initial?.username ?? ''),
    [token, setToken] = useApplicationState(''),
    [tokenEnv, setTokenEnv] = useApplicationState(initial?.tokenEnv ?? '')
  const [cliEnvironment, setCliEnvironment] = useApplicationState(
    formatAgentEnvironment(initial?.cliEnv),
  )
  const [cliProfile, setCliProfile] = useApplicationState(initial?.cliProfile ?? '')
  const [cliTool, setCliTool] = useApplicationState<'fj' | 'tea'>(initial?.cliTool ?? 'tea')
  const [credential, setCredential] = useApplicationState(initial?.credential ?? 'gh'),
    // Saved references are host-private; a replacement is only sent when the user enters one.
    [secret, setSecret] = useApplicationState<AgentSecretReference | undefined>(undefined),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false),
    [confirmRemove, setConfirmRemove] = useApplicationState(false)
  const pending = useRef(false)
  const retainedSecretName =
    initial?.credential === 'reference' &&
    initial.provider === provider &&
    initial.baseUrl === baseUrl.trim().replace(/\/+$/, '') &&
    initial.username === (username.trim() || undefined)
      ? secretReferenceProviders.find((item) => item.id === initial.secretProvider)?.name
      : undefined
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const input = decode(forgeConnectionInputSchema, {
            id: initial?.id,
            revision: initial?.revision,
            provider,
            name,
            baseUrl,
            username: username || undefined,
            credential,
            cliEnv: credential === 'gh-wrapper' ? parseAgentEnvironment(cliEnvironment) : undefined,
            ...(credential === 'cli' || credential === 'gh'
              ? {
                  cliProfile: cliProfile.trim() || undefined,
                  cliTool: ['gitea', 'forgejo'].includes(provider) ? cliTool : undefined,
                }
              : {}),
            ...(credential === 'token' && token.trim()
              ? {
                  token: token.trim(),
                }
              : {}),
            ...(credential === 'environment'
              ? {
                  tokenEnv: tokenEnv.trim(),
                }
              : {}),
            ...(credential === 'reference' && secret ? { secret } : {}),
          })
          yield* callEffect('/api/scm/connections/save', input, forgeConnectionSchema)
          setToken('')
          setSecret(undefined)
          onDone()
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <Sheet
      title={initial ? uiText('Edit account') : uiText('Connect account')}
      onClose={onClose}
      busy={busy}
    >
      <Choice
        label={uiText('Provider')}
        value={provider}
        onChange={(value) => {
          const next = decode(forgeProviderSchema, value)
          setProvider(next)
          setUsername('')
          setBaseUrl(defaults[next])
          setName(forgeLabels[next])
          setToken('')
          setCliProfile('')
          setSecret(undefined)
          setCredential(next === 'github' ? 'gh' : ['gitlab'].includes(next) ? 'token' : 'cli')
        }}
        disabled={busy}
        items={forgeProviderSchema.literals.map((id) => ({
          id,
          name: forgeLabels[id],
        }))}
      />
      <Field label={uiText('Account name')} value={name} onChangeText={setName} editable={!busy} />
      <Field
        label={uiText('Server URL')}
        value={baseUrl}
        onChangeText={setBaseUrl}
        editable={!busy && provider !== 'bitbucket'}
        autoCorrect={false}
        keyboardType="url"
      />
      {provider === 'github' && (
        <Choice
          label={uiText('Authentication')}
          value={credential}
          onChange={(next) => {
            if (
              next === 'gh' ||
              next === 'gh-wrapper' ||
              next === 'environment' ||
              next === 'token'
            ) {
              setCredential(next)
              setToken('')
            }
          }}
          disabled={busy}
          items={[
            { id: 'gh', name: uiText('GitHub CLI account') },
            { id: 'gh-wrapper', name: uiText('GitHub CLI wrapper · environment selector') },
            { id: 'environment', name: uiText('Token from runtime environment') },
            { id: 'token', name: uiText('API token') },
          ]}
        />
      )}
      {provider === 'github' && (credential === 'gh' || credential === 'gh-wrapper') ? (
        <Text style={styles.muted}>
          <InterfaceText
            values={{
              value0: (() => {
                try {
                  return new URL(baseUrl).hostname
                } catch {
                  return 'your-github-host'
                }
              })(),
            }}
          >
            {
              'Run gh auth login --hostname {value0} on this runtime. GitHub CLI stores the credential and supplies repository access.'
            }
          </InterfaceText>
        </Text>
      ) : (
        <>
          {provider === 'bitbucket' && credential !== 'cli' && (
            <Field
              label={uiText('Atlassian account email')}
              value={username}
              onChangeText={setUsername}
              editable={!busy}
              keyboardType="email-address"
              autoCorrect={false}
            />
          )}
          {provider !== 'github' && (
            <Choice
              label={uiText('Credential')}
              value={credential}
              onChange={(value) => {
                const next =
                  value === 'environment' || value === 'cli'
                    ? value
                    : value === 'reference' && provider === 'bitbucket'
                      ? value
                      : 'token'
                setCredential(next)
                setToken('')
                setSecret(
                  next === 'reference' && !retainedSecretName
                    ? defaultSecretReference('onepassword')
                    : undefined,
                )
              }}
              disabled={busy}
              items={[
                ...(['gitlab'].includes(provider)
                  ? []
                  : [{ id: 'cli', name: uiText('Signed-in CLI account') }]),
                {
                  id: 'token',
                  name: uiText('API token on runtime'),
                },
                {
                  id: 'environment',
                  name: uiText('Runtime environment variable'),
                },
                ...(provider === 'bitbucket'
                  ? [{ id: 'reference', name: uiText('Secret manager reference') }]
                  : []),
              ]}
            />
          )}
          {credential === 'cli' ? (
            <>
              {['gitea', 'forgejo'].includes(provider) && (
                <Choice
                  label={uiText('CLI')}
                  value={cliTool}
                  onChange={(v) => setCliTool(v === 'fj' ? 'fj' : 'tea')}
                  disabled={busy}
                  items={[
                    {
                      id: 'fj',
                      name: uiText('Forgejo CLI (fj)'),
                    },
                    {
                      id: 'tea',
                      name: uiText('Gitea CLI (tea)'),
                    },
                  ]}
                />
              )}

              <Text style={styles.muted}>
                <InterfaceText
                  values={{
                    value0:
                      provider === 'bitbucket'
                        ? uiText('gildas/bitbucket-cli (bb)')
                        : provider === 'azure-devops'
                          ? uiText('az login')
                          : cliTool,
                  }}
                >
                  {
                    'Uses {value0} on this runtime. Sign in there first. Git uses its own credential helper for fj/tea.'
                  }
                </InterfaceText>
              </Text>
            </>
          ) : credential === 'reference' ? (
            secret ? (
              <>
                <SecretReferenceFields value={secret} onChange={setSecret} disabled={busy} />
                {retainedSecretName && (
                  <Action
                    secondary
                    label={uiText('Keep saved {value0} reference', { value0: retainedSecretName })}
                    disabled={busy}
                    onPress={() => setSecret(undefined)}
                  />
                )}
              </>
            ) : (
              <>
                <Text style={styles.muted}>
                  {retainedSecretName
                    ? uiText(
                        '{value0} reference saved on this runtime. It is not shown on other devices.',
                        { value0: retainedSecretName },
                      )
                    : uiText('Enter the secret manager reference for this account.')}
                </Text>
                <Action
                  secondary
                  label={retainedSecretName ? uiText('Replace reference') : uiText('Add reference')}
                  disabled={busy}
                  onPress={() => setSecret(defaultSecretReference('onepassword'))}
                />
              </>
            )
          ) : credential === 'environment' ? (
            <Field
              label={uiText('Token environment variable')}
              value={tokenEnv}
              onChangeText={setTokenEnv}
              editable={!busy}
              placeholder={'DOVO_FORGE_TOKEN'}
              autoCorrect={false}
            />
          ) : (
            <Field
              label={
                initial ? uiText('Replace API token (leave blank to keep)') : uiText('API token')
              }
              value={token}
              onChangeText={setToken}
              editable={!busy}
              secureTextEntry
              autoCorrect={false}
            />
          )}
          {credential !== 'cli' && (
            <Text style={styles.muted}>
              {provider === 'bitbucket'
                ? uiText(
                    'Use a scoped Atlassian API token with repository, pull request and pipeline access for the features you use.',
                  )
                : provider === 'azure-devops'
                  ? uiText(
                      'Use an Azure DevOps PAT with Code, Work Items and Build permissions for the features you use.',
                    )
                  : uiText(
                      'Use a personal access token with access to the repositories, issues and pipeline actions you use. Repository-limited tokens can be linked by entering the repository directly.',
                    )}{' '}
              {credential === 'reference'
                ? uiText(
                    'The runtime reads the token with its own secret manager login and never returns the token or reference to clients. A rejected token or an explicit refresh reads the reference again.',
                  )
                : uiText(
                    'Tokens are stored in the runtime’s private database, outside workspace sync.',
                  )}
            </Text>
          )}
        </>
      )}
      {credential === 'gh-wrapper' && (
        <>
          <Field
            label={uiText('Wrapper selectors · NAME=value per line')}
            value={cliEnvironment}
            onChangeText={setCliEnvironment}
            editable={!busy}
            multiline
            autoCorrect={false}
          />
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Configure the gh wrapper in Runtime commands. These selectors are non-secret settings shared with paired clients.'
              }
            </InterfaceText>
          </Text>
        </>
      )}
      {(credential === 'cli' || credential === 'gh') && (
        <CliProfilePicker
          provider={provider}
          baseUrl={baseUrl}
          cliTool={['gitea', 'forgejo'].includes(provider) ? cliTool : undefined}
          connectionId={initial?.id}
          value={cliProfile}
          onChange={setCliProfile}
          disabled={busy || !connected}
        />
      )}
      <Text
        accessibilityRole={error ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={!error && !busy}
        importantForAccessibility={error || busy ? 'auto' : 'no-hide-descendants'}
        style={[error ? styles.error : styles.muted, { opacity: error || busy ? 1 : 0 }]}
      >
        {error || uiText('Saving account…')}
      </Text>
      <Action
        wide
        label={uiText('Save account')}
        disabled={busy || !connected}
        onPress={() => void submit()}
      />
      {onRemove && (
        <Action
          destructive={confirmRemove ? false : true}
          secondary
          label={confirmRemove ? uiText('Confirm remove account') : uiText('Remove account')}
          disabled={busy || !connected}
          onPress={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
        />
      )}
    </Sheet>
  )
}
function ProjectConnection({
  projectId,
  connections,
  onClose,
  onDone,
}: {
  projectId: string
  connections: ForgeConnection[]
  onClose: () => void
  onDone: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, connected, readEffect, callEffect } = useRuntime()
  const project = snapshot?.workspace.repositories.find((repo) => repo.id === projectId)
  const [connectionId, setConnection] = useApplicationState(
      project?.forge?.connectionId ?? connections[0]?.id ?? '',
    ),
    [repository, setRepository] = useApplicationState(project?.forge?.repository ?? '')
  const [directory, setDirectory] = useApplicationState(''),
    [customName, setName] = useApplicationState<string | null>(null),
    [browsing, setBrowsing] = useApplicationState(false),
    [choices, setChoices] = useApplicationState<
      Array<{
        id: string
        name: string
      }>
    >([])
  const [page, setPage] = useApplicationState(1),
    [hasMore, setMore] = useApplicationState(false),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const name = customName ?? suggestedProjectName(repository)
  const browse = (next = 1) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const result = yield* readEffect(
            '/api/scm/repositories/forge/read',
            {
              connectionId,
              repository,
              page: next,
              ...(project
                ? {
                    repositoryId: project.id,
                  }
                : {}),
            },
            forgeRepositoryPageSchema,
          )
          const rows = result.repositories.map((repo) => ({
            id: repo.fullName,
            name: repo.fullName,
          }))
          setChoices((current) => (next === 1 ? rows : [...current, ...rows]))
          setPage(next)
          setMore(result.hasMore)
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  const submit = (clear = false) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          if (project)
            yield* callEffect(
              '/api/scm/repositories/forge/bind',
              {
                repositoryId: project.id,
                forge: clear
                  ? null
                  : {
                      connectionId,
                      repository,
                    },
              },
              ok,
            )
          else
            yield* callEffect(
              '/api/scm/repositories/add',
              {
                source: 'forge',
                forge: {
                  connectionId,
                  repository,
                },
                name: name.trim() || repository.split('/').at(-1),
                directory,
              },
              repositorySchema,
            )
          onDone()
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <Sheet
      title={browsing ? uiText('Choose folder') : project ? project.name : uiText('Clone project')}
      scrollable={!browsing}
      onClose={onClose}
      busy={busy}
    >
      {browsing ? (
        <DirectoryPicker
          initialPath={directory}
          onClose={() => setBrowsing(false)}
          onSelect={(path) => {
            setDirectory(path)
            setBrowsing(false)
          }}
        />
      ) : (
        <>
          <Choice
            label={uiText('Account')}
            value={connectionId}
            onChange={(id) => {
              setConnection(id)
              setChoices([])
              setPage(1)
              setMore(false)
              setRepository('')
            }}
            disabled={busy}
            items={connections.map((connection) => ({
              id: connection.id,
              name: connection.name,
            }))}
          />
          <Field
            label={uiText('Repository')}
            value={repository}
            onChangeText={setRepository}
            editable={!busy}
            autoCorrect={false}
            placeholder={
              connections.find((connection) => connection.id === connectionId)?.provider ===
              'azure-devops'
                ? uiText('project/repository')
                : ['gitlab'].includes(
                      connections.find((connection) => connection.id === connectionId)?.provider ??
                        '',
                    )
                  ? uiText('group/subgroup/project')
                  : uiText('owner/repository')
            }
          />
          <Action
            secondary
            label={uiText('Browse repositories')}
            disabled={busy || !connected || !connectionId}
            onPress={() => void browse()}
          />
          {!!choices.length && (
            <Choice
              label={uiText('Accessible repositories')}
              value={repository}
              onChange={(value) => {
                setRepository(value)
                setName((current) => (current?.trim() ? current : null))
              }}
              disabled={busy}
              items={choices}
            />
          )}
          {hasMore && (
            <Action
              secondary
              label={uiText('Load more repositories')}
              disabled={busy}
              onPress={() => void browse(page + 1)}
            />
          )}
          {!project && (
            <>
              <Field
                label={uiText('Project name (optional)')}
                value={name}
                onChangeText={setName}
                editable={!busy}
              />
              <Field
                label={uiText('Clone parent folder on runtime')}
                value={directory}
                autoCorrect={false}
                onChangeText={setDirectory}
                editable={!busy}
              />
              <Action
                secondary
                label={uiText('Browse folders')}
                disabled={busy || !connected}
                onPress={() => setBrowsing(true)}
              />
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={
              busy
                ? uiText('Working…')
                : project
                  ? uiText('Connect project')
                  : uiText('Clone project')
            }
            disabled={
              busy ||
              !connected ||
              !connectionId ||
              !repository.trim() ||
              (!project && !directory.trim())
            }
            onPress={() => void submit()}
          />
          {project?.forge && (
            <Action
              secondary
              label={uiText('Use automatic GitHub connection')}
              disabled={busy || !connected}
              onPress={() => void submit(true)}
            />
          )}
        </>
      )}
    </Sheet>
  )
}
