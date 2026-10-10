import { useEffect } from 'react'
import { Copy, Star, Plus, Search } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  randomUUID,
  defaultTaskHarness,
  scopedSettingsResultSchema,
  settingsScopeLabels,
  scopedAgentEntries,
  modelDisplayName,
  providerDisplayName,
  runtimeDefaultsSchema,
  builtInAgentDefinition,
  type Agent,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { useWorkspace, providers } from '@dovo/studio-core'
import { AgentAvatar, Button, ChoicePicker, Input, SettingSource } from '@dovo/studio-ui'
import { AgentEditor } from './agent-editor'
import { ProviderCheck } from './provider-check'
export function ScopedAgents({
  scope,
  repository,
}: {
  scope: SettingsScope
  repository?: Repository
}) {
  const { snapshot, workspace, request, connected, refreshRuntimes } = useWorkspace()
  const [settings, setSettings] = useApplicationState<
    typeof scopedSettingsResultSchema.Type | null
  >(null)
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [editing, setEditing] = useApplicationState<Agent | null>(null)
  const [selectedId, setSelectedId] = useApplicationState('')
  const [dirty, setDirty] = useApplicationState(false)
  const [notice, setNotice] = useApplicationState('')
  const [query, setQuery] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    if (!connected || !snapshot?.scopedAgentsSupported) return
    let current = true
    void request(
      '/api/agents/settings/read',
      { scope, repositoryId: repository?.id, includeAgents: true },
      scopedSettingsResultSchema,
    )
      .then((value) => {
        if (current) {
          setSettings(value)
          setError('')
        }
      })
      .catch((error: unknown) => {
        if (current) setError(message(error))
      })
    return () => {
      current = false
    }
  }, [request, connected, scope, repository?.id, snapshot?.scopedAgentsSupported, retry])
  const save = async (agents: Agent[]) => {
    if (!settings) throw new Error('Reload settings before saving')
    setBusy(true)
    setError('')
    try {
      const value = await request(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: settings.projectKey,
          includeAgents: true,
          before: settings.value,
          after: { ...settings.value, agents },
        },
        scopedSettingsResultSchema,
      )
      setSettings(value)
    } finally {
      setBusy(false)
    }
  }
  const own = settings?.value.agents ?? []
  const origins = scopedAgentEntries(snapshot?.defaults, repository, workspace.agents, scope)
  const inherited = settings?.inherited.agents ?? []
  const agents = [...new Map([...inherited, ...own].map((agent) => [agent.id, agent])).values()]
  if (!snapshot?.scopedAgentsSupported)
    return (
      <p role="status" className="rounded-xl border p-4 text-xs text-muted-foreground">
        Update Dovo on this computer to manage agent profiles at every settings level.
      </p>
    )
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0]
  const local = selected && own.some((entry) => entry.id === selected.id)
  const inheritedSelected = selected && inherited.some((entry) => entry.id === selected.id)
  const filtered = agents.filter((agent) =>
    `${agent.name} ${agent.provider} ${agent.model}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const origin = origins.find((entry) => entry.agent.id === selected?.id)?.scope ?? 'built-in'
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Agent profiles</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Each built-in provider has a profile that uses the computer’s own installation and
            sign-in. Customize one here, or add your own profile for a different model or role.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || !settings || busy}
          onClick={() =>
            setEditing({
              ...defaultTaskHarness('codex'),
              permission: 'ask',
              id: randomUUID(),
              name: '',
            })
          }
        >
          <Plus size={14} /> Add profile
        </Button>
      </div>
      <div className="lg:hidden">
        <ChoicePicker
          aria-label="Agent profile"
          value={selected?.id ?? ''}
          disabled={busy || !agents.length}
          onValueChange={(id) => {
            if (id === selected?.id) return
            if (dirty && !window.confirm('Discard unsaved configuration changes?')) return
            setNotice('')
            setSelectedId(id)
          }}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} · {own.some((entry) => entry.id === agent.id) ? 'Set here' : 'Inherited'}
            </option>
          ))}
        </ChoicePicker>
      </div>
      <div className="grid overflow-hidden rounded-xl border lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav
          aria-label="Provider configurations"
          className="hidden min-w-0 border-r bg-card/30 lg:block"
        >
          <div className="border-b p-3">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
              />
              <Input
                aria-label="Search agent profiles"
                className="h-9 pl-8 text-xs"
                placeholder="Find an agent…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:block">
            {filtered.map((agent) => {
              const local = own.some((entry) => entry.id === agent.id)
              const origin = origins.find((entry) => entry.agent.id === agent.id)?.scope
              const provider = providers[agent.provider].short ?? providers[agent.provider].name
              const model = modelDisplayName(agent.model) || 'Default model'
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-pressed={selected?.id === agent.id}
                  disabled={busy}
                  onClick={() => {
                    if (agent.id === selected?.id) return
                    if (dirty && !window.confirm('Discard unsaved configuration changes?')) return
                    setNotice('')
                    setSelectedId(agent.id)
                  }}
                  className={`flex w-full items-start gap-3 border-b border-l-2 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected?.id === agent.id ? 'border-l-primary bg-primary/8' : 'border-l-transparent'}`}
                >
                  <AgentAvatar
                    provider={agent.provider}
                    customIcon={agent.icon}
                    className="mt-0.5 size-6 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {agent.name === providerDisplayName(agent.provider)
                        ? model
                        : `${provider} · ${model}`}
                    </span>
                    <span
                      className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${local ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                    >
                      {local
                        ? 'Customized here'
                        : origin === 'built-in'
                          ? 'Built-in'
                          : `From ${origin ? settingsScopeLabels[origin] : 'an earlier level'}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {!agents.length && (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              {settings
                ? 'No agent profiles yet.'
                : error
                  ? 'Profiles unavailable.'
                  : 'Loading profiles…'}
            </p>
          )}
          {agents.length > 0 && !filtered.length && (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              No profiles match “{query}”.
            </p>
          )}
        </nav>
        <div className="min-w-0 p-4 lg:p-6">
          {selected ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AgentAvatar provider={selected.provider} className="size-5" />
                  <h3 className="text-sm font-medium">{selected.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Duplicate ${selected.name}`}
                    title="Duplicate as a new profile"
                    disabled={!connected || busy}
                    onClick={() =>
                      setEditing({ ...selected, id: randomUUID(), name: `${selected.name} copy` })
                    }
                  >
                    <Copy size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Favorite ${selected.name}`}
                    title="Favorite: show first in the composer"
                    aria-pressed={
                      !!snapshot?.defaults?.modelPreferences?.[`agent:${selected.id}`]?.favorite
                    }
                    disabled={!connected || busy}
                    onClick={() => {
                      setBusy(true)
                      void request(
                        '/api/agents/models/preference',
                        {
                          key: `agent:${selected.id}`,
                          favorite:
                            !snapshot?.defaults?.modelPreferences?.[`agent:${selected.id}`]
                              ?.favorite,
                        },
                        runtimeDefaultsSchema,
                      )
                        .then(() => refreshRuntimes())
                        .catch((error: unknown) => setError(message(error)))
                        .finally(() => setBusy(false))
                    }}
                  >
                    <Star
                      size={14}
                      fill={
                        snapshot?.defaults?.modelPreferences?.[`agent:${selected.id}`]?.favorite
                          ? 'currentColor'
                          : 'none'
                      }
                    />
                  </Button>
                  {local && (
                    <Button
                      size="sm"
                      variant="outline"
                      title={
                        inheritedSelected
                          ? `Remove the ${settingsScopeLabels[scope]} override`
                          : 'Delete this profile'
                      }
                      disabled={!connected || busy}
                      onClick={() => {
                        if (
                          !inheritedSelected &&
                          !window.confirm(
                            `Delete “${selected.name}”? Existing threads keep their configuration.`,
                          )
                        )
                          return
                        void save(own.filter((entry) => entry.id !== selected.id))
                          .then(() =>
                            setNotice(
                              inheritedSelected
                                ? `${selected.name} now uses the inherited configuration.`
                                : '',
                            ),
                          )
                          .catch((error: unknown) => setError(message(error)))
                      }}
                    >
                      {inheritedSelected ? 'Reset' : 'Delete'}
                    </Button>
                  )}
                </div>
              </div>
              <div className="mb-5 space-y-2 rounded-lg border bg-muted/30 p-3">
                <SettingSource
                  label={selected.name}
                  origin={{ source: local ? scope : origin, overridden: !!local }}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {local
                    ? `Customized at ${settingsScopeLabels[scope]}. ${inheritedSelected ? 'Reset removes this override and restores the inherited configuration.' : 'This profile was created here; more specific levels can still override it.'}`
                    : `Using the ${origin === 'built-in' ? 'built-in' : settingsScopeLabels[origin]} configuration. Saving creates an override at ${settingsScopeLabels[scope]}; Reset then restores the inherited one.`}
                </p>
                {builtInAgentDefinition(selected.id) && (
                  <p className="text-xs text-muted-foreground">
                    {builtInAgentDefinition(selected.id)?.description}
                  </p>
                )}
              </div>
              <AgentEditor
                key={JSON.stringify(selected)}
                initial={selected}
                creating={false}
                inline
                fixedProvider={!!builtInAgentDefinition(selected.id)}
                onDirtyChange={setDirty}
                computerName={settingsScopeLabels[scope]}
                onClose={() => {}}
                onSave={async (agent) => {
                  await save([...own.filter((entry) => entry.id !== agent.id), agent])
                  setNotice(`${agent.name} saved at ${settingsScopeLabels[scope]}.`)
                }}
              />
              {notice && (
                <p role="status" className="mt-3 text-xs text-muted-foreground">
                  {notice}
                </p>
              )}
              <details className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Check installation & sign-in</summary>
                <ProviderCheck
                  key={JSON.stringify(selected)}
                  agent={selected}
                  repositoryId={repository?.id}
                  settingsScope={scope}
                />
              </details>
            </>
          ) : !settings ? (
            <div
              role="status"
              className="flex min-h-64 flex-col items-center justify-center gap-2 text-center"
            >
              <h3 className="text-sm font-medium">
                {!connected
                  ? 'Computer offline'
                  : error
                    ? 'Profiles could not be loaded'
                    : 'Loading agent profiles…'}
              </h3>
              <p className="max-w-sm text-xs text-muted-foreground">
                {!connected
                  ? 'Reconnect this computer to view and edit its agent profiles.'
                  : error
                    ? 'Check the error below, then reload.'
                    : 'Reading saved profiles for this level.'}
              </p>
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
              <h3 className="text-sm font-medium">Set up your first provider</h3>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add a reusable configuration for an installed provider or an agent from the ACP
                registry.
              </p>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved configuration changes?'))
                setRetry(retry + 1)
            }}
          >
            Reload profiles
          </Button>
        </p>
      )}
      {editing && (
        <AgentEditor
          key={editing.id}
          initial={editing}
          creating
          computerName={settingsScopeLabels[scope]}
          onClose={() => setEditing(null)}
          onSave={async (agent) => {
            await save([...own.filter((entry) => entry.id !== agent.id), agent])
            setSelectedId(agent.id)
          }}
        />
      )}
    </section>
  )
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
