import { useApplicationState } from '@dovo/studio-core/state'
import { validationMessages } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { CliProfilePicker } from './cli-profile-picker'
import { useEffect, useRef } from 'react'
import { Link2, Plus } from 'lucide-react'
import {
  forgeConnectionInputSchema,
  forgeConnectionSchema,
  forgeConnectionsSchema,
  forgeLabels,
  forgeProviderSchema,
  responses,
  useWorkspace,
  type ForgeConnection,
  type ForgeProvider,
  clientScopeKey,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@dovo/studio-ui'
export function useForgeConnections() {
  const { connected, request, readCache } = useWorkspace()
  const [connections, setConnections] = useApplicationState<ForgeConnection[]>([])
  const [revision, reload] = useApplicationState(0)
  const [loading, setLoading] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [cacheError, setCacheError] = useApplicationState('')
  useEffect(() => {
    let current = true
    let received = false
    setError('')
    setCacheError('')
    void readCache
      ?.read('scm-connections', forgeConnectionsSchema)
      .then((cached) => {
        if (current && !received && cached) setConnections(cached.value.connections)
      })
      .catch(() => {
        if (current) setCacheError('Could not load saved accounts.')
      })
    setLoading(connected)
    if (connected)
      void request('/api/scm/connections/read', {}, forgeConnectionsSchema)
        .then(async (value) => {
          received = true
          if (!current) return
          setConnections(value.connections)
          try {
            await readCache?.write('scm-connections', value)
          } catch {
            if (current)
              setCacheError('Accounts loaded, but could not be saved for offline access.')
          }
        })
        .catch((error: unknown) => {
          if (current) setError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    return () => {
      current = false
    }
  }, [connected, request, revision, readCache])
  return {
    connections,
    loading,
    error: error || cacheError,
    reload: () => reload((v) => v + 1),
  }
}
const defaults: Record<ForgeProvider, string> = {
  github: 'https://github.com',
  bitbucket: 'https://api.bitbucket.org/2.0',
  forgejo: '',
  gitea: '',
  'azure-devops': '',
}
const placeholders: Record<ForgeProvider, string> = {
  github: 'https://github.com',
  bitbucket: 'https://api.bitbucket.org/2.0',
  forgejo: 'https://git.example.com',
  gitea: 'https://git.example.com',
  'azure-devops': 'https://dev.azure.com/your-organization',
}
function ConnectionForm({
  value,
  repositoryId,
  onDone,
  onCancel,
}: {
  value?: ForgeConnection
  repositoryId?: string
  onDone: () => void
  onCancel: () => void
}) {
  const { request, connected } = useWorkspace()
  const [provider, setProvider] = useApplicationState<ForgeProvider>(value?.provider ?? 'github')
  const [name, setName] = useApplicationState(value?.name ?? '')
  const [baseUrl, setBaseUrl] = useApplicationState(value?.baseUrl ?? defaults.github)
  const [username, setUsername] = useApplicationState(value?.username ?? '')
  const [credential, setCredential] = useApplicationState<ForgeConnection['credential']>(
    value?.credential ?? 'gh',
  )
  const [cliProfile, setCliProfile] = useApplicationState(value?.cliProfile ?? '')
  const [cliTool, setCliTool] = useApplicationState<'fj' | 'tea'>(value?.cliTool ?? 'tea')
  const [token, setToken] = useApplicationState('')
  const [tokenEnv, setTokenEnv] = useApplicationState(value?.tokenEnv ?? '')
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const running = useRef(false)
  const retainsToken =
    value?.credential === 'token' &&
    value.provider === provider &&
    value.baseUrl === baseUrl.trim().replace(/\/+$/, '') &&
    value.username === (username.trim() || undefined)
  let githubHost = ''
  try {
    githubHost = new URL(baseUrl).hostname
  } catch {
    /* The form validates an incomplete URL on save. */
  }
  return (
    <form
      className="grid gap-4"
      aria-label={value ? 'Edit source control connection' : 'New source control connection'}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (running.current) return
        const parsed = decodeResult(forgeConnectionInputSchema, {
          ...(value
            ? {
                id: value.id,
              }
            : {}),
          name: name.trim() || forgeLabels[provider],
          provider,
          baseUrl: baseUrl.trim(),
          credential,
          ...(credential === 'cli' || credential === 'gh'
            ? {
                cliProfile: cliProfile.trim() || undefined,
                cliTool: ['gitea', 'forgejo'].includes(provider) ? cliTool : undefined,
              }
            : {}),
          ...(username.trim()
            ? {
                username: username.trim(),
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
        if (!parsed.success) {
          setError(validationMessages(parsed.error)[0] ?? 'Check the connection details.')
          return
        }
        running.current = true
        setBusy(true)
        setError('')
        void request('/api/scm/connections/save', parsed.data, forgeConnectionSchema)
          .then(() => {
            setToken('')
            onDone()
          })
          .catch((error: unknown) =>
            setError(error instanceof Error ? error.message : String(error)),
          )
          .finally(() => {
            running.current = false
            setBusy(false)
          })
      }}
    >
      <fieldset disabled={busy || !connected} className="grid gap-4">
        <FormField label="Provider">
          <ChoicePicker
            aria-label="Source control provider"
            value={provider}
            onValueChange={(next) => {
              const chosen = decode(forgeProviderSchema, next)
              setProvider(chosen)
              setBaseUrl(defaults[chosen])
              setToken('')
              setUsername('')
              setCliProfile('')
              setCredential(chosen === 'github' ? 'gh' : 'cli')
              setError('')
            }}
          >
            {forgeProviderSchema.literals.map((kind) => (
              <option key={kind} value={kind}>
                {forgeLabels[kind]}
              </option>
            ))}
          </ChoicePicker>
        </FormField>
        <FormField label="Connection name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${forgeLabels[provider]} · Work`}
            maxLength={100}
          />
        </FormField>
        <FormField label={provider === 'azure-devops' ? 'Organization URL' : 'Server URL'}>
          <Input
            required
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={placeholders[provider]}
            spellCheck={false}
          />
        </FormField>
        {provider === 'bitbucket' && credential !== 'cli' && (
          <FormField label="Atlassian account email">
            <Input
              required
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </FormField>
        )}
        {provider === 'github' ? (
          <p className="text-xs text-muted-foreground">
            Uses GitHub CLI authentication on this runtime. Sign in there with{' '}
            <code>gh auth login{githubHost ? ` --hostname ${githubHost}` : ''}</code>.
          </p>
        ) : (
          <>
            <FormField label="Authentication">
              <ChoicePicker
                aria-label="Authentication method"
                value={credential}
                onValueChange={(next) => {
                  if (next === 'token' || next === 'environment' || next === 'cli') {
                    setCredential(next)
                    setToken('')
                  }
                }}
              >
                <option value="cli">Signed-in CLI account</option>
                <option value="token">API token</option>
                <option value="environment">Runtime environment variable</option>
              </ChoicePicker>
            </FormField>
            {credential === 'cli' ? (
              <>
                {['gitea', 'forgejo'].includes(provider) && (
                  <FormField label="CLI">
                    <ChoicePicker
                      aria-label="CLI"
                      value={cliTool}
                      onValueChange={(v) => setCliTool(v === 'fj' ? 'fj' : 'tea')}
                    >
                      <option value="fj">Forgejo CLI (fj)</option>
                      <option value="tea">Gitea CLI (tea)</option>
                    </ChoicePicker>
                  </FormField>
                )}

                <p className="text-xs text-muted-foreground">
                  Uses{' '}
                  {provider === 'bitbucket'
                    ? 'gildas/bitbucket-cli (bb)'
                    : provider === 'azure-devops'
                      ? 'az login'
                      : cliTool}{' '}
                  on this runtime. Sign in there first. Credentials stay on the host. Git uses its
                  own credential helper for fj/tea.
                </p>
              </>
            ) : credential === 'token' ? (
              <FormField label={retainsToken ? 'Replace token (optional)' : 'API token'}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required={!retainsToken}
                  placeholder={
                    retainsToken ? 'Leave blank to keep the saved token' : 'Paste your access token'
                  }
                />
              </FormField>
            ) : (
              <FormField label="Environment variable">
                <Input
                  required
                  value={tokenEnv}
                  onChange={(e) => setTokenEnv(e.target.value)}
                  placeholder="DOVO_FORGE_TOKEN"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </FormField>
            )}
            {credential !== 'cli' && (
              <p className="text-xs text-muted-foreground">
                {provider === 'bitbucket'
                  ? 'Bitbucket Cloud: use a scoped API token with repository, pull-request and pipeline access for the features you use.'
                  : provider === 'azure-devops'
                    ? 'Azure DevOps Services: use a personal access token with Code, Work Items and Build permissions for the features you use.'
                    : 'Allow access to the repositories, issues and pipeline actions you use. Add user read access to browse repositories and identify your review requests.'}{' '}
                {credential === 'environment'
                  ? 'Set the variable on the runtime host and restart it.'
                  : 'The token stays on this runtime and is never returned to clients.'}
              </p>
            )}
          </>
        )}
        {(credential === 'cli' || credential === 'gh') && (
          <CliProfilePicker
            provider={provider}
            baseUrl={baseUrl}
            cliTool={['gitea', 'forgejo'].includes(provider) ? cliTool : undefined}
            connectionId={value?.id}
            initialRepositoryId={repositoryId}
            value={cliProfile}
            onChange={setCliProfile}
            disabled={busy || !connected}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{busy ? 'Saving…' : 'Save connection'}</Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
function ConnectionsContent({
  onChange,
  repositoryId,
}: {
  onChange?: () => void
  repositoryId?: string
}) {
  const { request, connected, workspace } = useWorkspace()
  const { connections, loading, error, reload } = useForgeConnections()
  const [editing, setEditing] = useApplicationState<ForgeConnection | 'new' | null>(null)
  const [removing, setRemoving] = useApplicationState<string | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [failure, setFailure] = useApplicationState('')
  const running = useRef(false)
  if (editing)
    return (
      <ConnectionForm
        repositoryId={repositoryId}
        key={editing === 'new' ? 'new' : editing.id}
        value={editing === 'new' ? undefined : editing}
        onCancel={() => setEditing(null)}
        onDone={() => {
          setEditing(null)
          reload()
          onChange?.()
        }}
      />
    )
  return (
    <section className="grid gap-3" aria-label="Source control connections">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Accounts available on this runtime.</p>
        <Button size="sm" disabled={!connected || busy} onClick={() => setEditing('new')}>
          <Plus className="size-4" />
          Add connection
        </Button>
      </div>
      {!connected && (
        <p role="status" className="text-sm text-muted-foreground">
          Offline · Showing saved accounts. Reconnect this computer to make changes.
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading connections…
        </p>
      )}
      {!loading && connected && !connections.length && !error && (
        <p className="py-4 text-sm text-muted-foreground">
          Connect a provider to browse repositories and manage pull requests, issues and pipelines.
          Existing GitHub projects continue using the runtime’s GitHub CLI login.
        </p>
      )}
      <div className="divide-y">
        {connections.map((connection) => {
          const linked = workspace.repositories.filter(
            (r) => r.forge?.connectionId === connection.id,
          )
          return (
            <article key={connection.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{connection.name}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {forgeLabels[connection.provider]} · {connection.baseUrl}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {linked.length
                    ? `${linked.length} linked project${linked.length === 1 ? '' : 's'}`
                    : 'No linked projects'}{' '}
                  ·{' '}
                  {connection.credential === 'gh'
                    ? `GitHub CLI${connection.cliProfile ? ` · ${connection.cliProfile}` : ''}`
                    : connection.credential === 'environment'
                      ? connection.tokenEnv
                      : connection.credential === 'cli'
                        ? `CLI · ${connection.cliProfile || connection.cliTool || 'az'}`
                        : 'Token saved'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!connected || busy}
                  onClick={() => {
                    setEditing(connection)
                    setRemoving(null)
                    setFailure('')
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!connected || busy || !!linked.length}
                  title={
                    linked.length
                      ? 'Disconnect this account from its project settings first'
                      : undefined
                  }
                  onClick={() => setRemoving(connection.id)}
                >
                  Remove
                </Button>
              </div>
              {removing === connection.id && (
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                  <span className="mr-auto text-xs">
                    Remove {connection.name} from this runtime?
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRemoving(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || !connected}
                    onClick={() => {
                      if (running.current) return
                      running.current = true
                      setBusy(true)
                      setFailure('')
                      void request(
                        '/api/scm/connections/remove',
                        {
                          id: connection.id,
                        },
                        responses.ok,
                      )
                        .then(() => {
                          setRemoving(null)
                          reload()
                          onChange?.()
                        })
                        .catch((error: unknown) =>
                          setFailure(error instanceof Error ? error.message : String(error)),
                        )
                        .finally(() => {
                          running.current = false
                          setBusy(false)
                        })
                    }}
                  >
                    {busy ? 'Removing…' : 'Remove connection'}
                  </Button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      {(error || failure) && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error || failure}
        </p>
      )}
      {error && (
        <Button variant="outline" size="sm" disabled={loading || !connected} onClick={reload}>
          Retry
        </Button>
      )}
    </section>
  )
}
export function ForgeConnections({
  onChange,
  repositoryId,
}: {
  onChange?: () => void
  repositoryId?: string
}) {
  const { connection } = useWorkspace()
  return (
    <ConnectionsContent
      key={clientScopeKey(connection)}
      onChange={onChange}
      repositoryId={repositoryId}
    />
  )
}
export function ForgeConnectionsButton({
  onChange,
  repositoryId,
}: {
  onChange?: () => void
  repositoryId?: string
}) {
  const [open, setOpen] = useApplicationState(false)
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Link2 className="size-4" />
        Connections
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Source control</DialogTitle>
            <DialogDescription>
              Connect GitHub, Bitbucket, Forgejo, Gitea or Azure DevOps to this runtime.
            </DialogDescription>
          </DialogHeader>
          <ForgeConnections onChange={onChange} repositoryId={repositoryId} />
        </DialogContent>
      </Dialog>
    </>
  )
}
