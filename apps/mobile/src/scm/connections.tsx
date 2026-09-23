import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { ScreenHeader } from '../ui/screen-header'
import { CliProfilePicker } from './cli-profile-picker'
import { useEffect, useRef } from 'react'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import { ScrollView, View } from 'react-native'
import { Schema, Effect } from 'effect'
import {
  forgeLabels,
  forgeProviderSchema,
  forgeConnectionSchema,
  forgeConnectionsSchema,
  forgeConnectionInputSchema,
  forgeRepositoryPageSchema,
  repositorySchema,
  type ForgeConnection,
  type ForgeProvider,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Field } from '../ui/field'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { SettingsGroup, SettingsRow } from '../screens/settings-group'
import { DirectoryPicker } from './directory-picker'
const defaults: Record<ForgeProvider, string> = {
  github: 'https://github.com',
  bitbucket: 'https://api.bitbucket.org/2.0',
  forgejo: 'https://codeberg.org',
  gitea: 'https://gitea.example.com',
  'azure-devops': 'https://dev.azure.com/organization',
}
const ok = mutableStruct({
  ok: Schema.Boolean,
})
export default function SourceControlSettings() {
  const { overviews } = useRuntime()
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Source control" />
      <Text style={styles.muted}>
        Accounts and linked projects across your computers. Credentials stay on their host.
      </Text>
      {!overviews.length && (
        <Text style={styles.muted}>Connect a computer to manage source-control accounts.</Text>
      )}
      {overviews.map((entry) => (
        <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
          <View
            style={{
              gap: 12,
            }}
          >
            <Text style={styles.text}>
              {entry.profile.name}
              {entry.connected ? '' : ' · Offline'}
            </Text>
            <ConnectionsContent />
          </View>
        </RuntimeScope>
      ))}
    </ScrollView>
  )
}
function ConnectionsContent() {
  const { read, connected, snapshot, readCache, callEffect, readEffect } = useRuntime()
  const [connections, setConnections] = useApplicationState<ForgeConnection[]>([]),
    [error, setError] = useApplicationState(''),
    [revision, setRevision] = useApplicationState(0)
  const [editing, setEditing] = useApplicationState<ForgeConnection | 'new' | null>(null),
    [project, setProject] = useApplicationState<string | null>(null)
  useEffect(() => {
    let active = true
    let received = false
    setError('')
    if (readCache)
      void runClientEffect(
        readCache.readEffect('scm-connections', forgeConnectionsSchema).pipe(
          Effect.tap((cached) =>
            Effect.sync(() => {
              if (active && !received && cached) setConnections(cached.value.connections)
            }),
          ),
          Effect.catchAll(() =>
            Effect.sync(() => {
              if (active) setError('Could not load saved accounts.')
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
                  Effect.catchAll((_error) =>
                    nativeEffect(() => {
                      if (active)
                        setError('Accounts loaded, but could not be saved for offline access.')
                    }),
                  ),
                )
              }),
            ),
          )
          .pipe(
            Effect.catchAll((cause) =>
              nativeEffect(() => {
                if (active) setError(String(cause))
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
            },
            ok,
          )
          done()
        }).pipe(
          Effect.catchAll((cause) =>
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
            Offline · Showing saved accounts. Reconnect this computer to make changes.
          </Text>
        )}
        <SettingsGroup title="Accounts">
          {connections.map((connection, index) => (
            <SettingsRow
              key={connection.id}
              title={connection.name}
              subtitle={`${forgeLabels[connection.provider]} · ${connection.baseUrl}`}
              icon="changes"
              disabled={!connected}
              onPress={() => setEditing(connection)}
              last={index === connections.length - 1}
            />
          ))}
        </SettingsGroup>
        <Action label="Connect account" disabled={!connected} onPress={() => setEditing('new')} />
        <Text style={styles.muted}>
          GitHub projects already use the runtime’s GitHub CLI login. Add a connection to use
          another account host or provider.
        </Text>
        <SettingsGroup title="Projects">
          {(snapshot?.workspace.repositories ?? []).map((repo, index) => (
            <SettingsRow
              key={repo.id}
              title={repo.name}
              subtitle={
                repo.forge
                  ? `${connections.find((connection) => connection.id === repo.forge?.connectionId)?.name ?? 'Account'} · ${repo.forge.repository}`
                  : 'Automatic GitHub connection'
              }
              icon="folder"
              disabled={!connected}
              onPress={() => setProject(repo.id)}
              last={index === (snapshot?.workspace.repositories.length ?? 0) - 1}
            />
          ))}
        </SettingsGroup>
        <Action
          secondary
          label="Clone a project"
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
            label="Retry accounts"
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
  const { connected, callEffect } = useRuntime()
  const [provider, setProvider] = useApplicationState<ForgeProvider>(initial?.provider ?? 'github'),
    [name, setName] = useApplicationState(initial?.name ?? 'GitHub'),
    [baseUrl, setBaseUrl] = useApplicationState(initial?.baseUrl ?? defaults.github)
  const [username, setUsername] = useApplicationState(initial?.username ?? ''),
    [token, setToken] = useApplicationState(''),
    [tokenEnv, setTokenEnv] = useApplicationState(initial?.tokenEnv ?? '')
  const [cliProfile, setCliProfile] = useApplicationState(initial?.cliProfile ?? '')
  const [cliTool, setCliTool] = useApplicationState<'fj' | 'tea'>(initial?.cliTool ?? 'tea')
  const [credential, setCredential] = useApplicationState(initial?.credential ?? 'gh'),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false),
    [confirmRemove, setConfirmRemove] = useApplicationState(false)
  const pending = useRef(false)
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
            provider,
            name,
            baseUrl,
            username: username || undefined,
            credential,
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
          })
          yield* callEffect('/api/scm/connections/save', input, forgeConnectionSchema)
          setToken('')
          onDone()
        }).pipe(
          Effect.catchAll((cause) =>
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
    <Sheet title={initial ? 'Edit account' : 'Connect account'} onClose={onClose} busy={busy}>
      <Choice
        label="Provider"
        value={provider}
        onChange={(value) => {
          const next = decode(forgeProviderSchema, value)
          setProvider(next)
          setUsername('')
          setBaseUrl(defaults[next])
          setName(forgeLabels[next])
          setToken('')
          setCliProfile('')
          setCredential(next === 'github' ? 'gh' : 'cli')
        }}
        disabled={busy}
        items={forgeProviderSchema.literals.map((id) => ({
          id,
          name: forgeLabels[id],
        }))}
      />
      <Field label="Account name" value={name} onChangeText={setName} editable={!busy} />
      <Field
        label="Server URL"
        value={baseUrl}
        onChangeText={setBaseUrl}
        editable={!busy && provider !== 'bitbucket'}
        autoCorrect={false}
        keyboardType="url"
      />
      {provider === 'github' ? (
        <Text style={styles.muted}>
          Run gh auth login --hostname{' '}
          {(() => {
            try {
              return new URL(baseUrl).hostname
            } catch {
              return 'your-github-host'
            }
          })()}{' '}
          on this runtime. GitHub CLI stores the credential and supplies repository access.
        </Text>
      ) : (
        <>
          {provider === 'bitbucket' && credential !== 'cli' && (
            <Field
              label="Atlassian account email"
              value={username}
              onChangeText={setUsername}
              editable={!busy}
              keyboardType="email-address"
              autoCorrect={false}
            />
          )}
          <Choice
            label="Credential"
            value={credential}
            onChange={(value) => {
              setCredential(
                value === 'environment' ? 'environment' : value === 'cli' ? 'cli' : 'token',
              )
              setToken('')
            }}
            disabled={busy}
            items={[
              {
                id: 'cli',
                name: 'Signed-in CLI account',
              },
              {
                id: 'token',
                name: 'API token on runtime',
              },
              {
                id: 'environment',
                name: 'Runtime environment variable',
              },
            ]}
          />
          {credential === 'cli' ? (
            <>
              {['gitea', 'forgejo'].includes(provider) && (
                <Choice
                  label="CLI"
                  value={cliTool}
                  onChange={(v) => setCliTool(v === 'fj' ? 'fj' : 'tea')}
                  disabled={busy}
                  items={[
                    {
                      id: 'fj',
                      name: 'Forgejo CLI (fj)',
                    },
                    {
                      id: 'tea',
                      name: 'Gitea CLI (tea)',
                    },
                  ]}
                />
              )}

              <Text style={styles.muted}>
                Uses{' '}
                {provider === 'bitbucket'
                  ? 'gildas/bitbucket-cli (bb)'
                  : provider === 'azure-devops'
                    ? 'az login'
                    : cliTool}{' '}
                on this runtime. Sign in there first. Git uses its own credential helper for fj/tea.
              </Text>
            </>
          ) : credential === 'environment' ? (
            <Field
              label="Token environment variable"
              value={tokenEnv}
              onChangeText={setTokenEnv}
              editable={!busy}
              placeholder="DOVO_FORGE_TOKEN"
              autoCorrect={false}
            />
          ) : (
            <Field
              label={initial ? 'Replace API token (leave blank to keep)' : 'API token'}
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
                ? 'Use a scoped Atlassian API token with repository, pull request and pipeline access for the features you use.'
                : provider === 'azure-devops'
                  ? 'Use an Azure DevOps PAT with Code, Work Items and Build permissions for the features you use.'
                  : 'Use a personal access token with access to the repositories, issues and pipeline actions you use. Repository-limited tokens can be linked by entering the repository directly.'}{' '}
              Tokens are stored in the runtime’s private database, outside workspace sync.
            </Text>
          )}
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
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={busy ? 'Saving…' : 'Save account'}
        disabled={busy || !connected}
        onPress={() => void submit()}
      />
      {onRemove && (
        <Action
          secondary
          label={confirmRemove ? 'Confirm remove account' : 'Remove account'}
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
  const { snapshot, connected, readEffect, callEffect } = useRuntime()
  const project = snapshot?.workspace.repositories.find((repo) => repo.id === projectId)
  const [connectionId, setConnection] = useApplicationState(
      project?.forge?.connectionId ?? connections[0]?.id ?? '',
    ),
    [repository, setRepository] = useApplicationState(project?.forge?.repository ?? '')
  const [directory, setDirectory] = useApplicationState(''),
    [name, setName] = useApplicationState(''),
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
          Effect.catchAll((cause) =>
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
          Effect.catchAll((cause) =>
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
      title={browsing ? 'Choose folder' : project ? project.name : 'Clone project'}
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
            label="Account"
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
            label="Repository"
            value={repository}
            onChangeText={setRepository}
            editable={!busy}
            autoCorrect={false}
            placeholder={
              connections.find((connection) => connection.id === connectionId)?.provider ===
              'azure-devops'
                ? 'project/repository'
                : 'owner/repository'
            }
          />
          <Action
            secondary
            label="Browse repositories"
            disabled={busy || !connected || !connectionId}
            onPress={() => void browse()}
          />
          {!!choices.length && (
            <Choice
              label="Accessible repositories"
              value={repository}
              onChange={setRepository}
              disabled={busy}
              items={choices}
            />
          )}
          {hasMore && (
            <Action
              secondary
              label="Load more repositories"
              disabled={busy}
              onPress={() => void browse(page + 1)}
            />
          )}
          {!project && (
            <>
              <Field
                label="Project name (optional)"
                value={name}
                onChangeText={setName}
                editable={!busy}
              />
              <Field
                label="Clone parent folder on runtime"
                value={directory}
                autoCorrect={false}
                onChangeText={setDirectory}
                editable={!busy}
              />
              <Action
                secondary
                label="Browse folders"
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
            label={busy ? 'Working…' : project ? 'Connect project' : 'Clone project'}
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
              label="Use automatic GitHub connection"
              disabled={busy || !connected}
              onPress={() => void submit(true)}
            />
          )}
        </>
      )}
    </Sheet>
  )
}
