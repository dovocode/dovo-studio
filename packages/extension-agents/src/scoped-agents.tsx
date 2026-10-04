import { useEffect } from 'react'
import { Copy, Star, Plus } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  randomUUID,
  defaultTaskHarness,
  scopedSettingsResultSchema,
  settingsScopeLabels,
  scopedAgentEntries,
  modelDisplayName,
  runtimeDefaultsSchema,
  type Agent,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { useWorkspace, providers } from '@dovo/studio-core'
import { AgentAvatar, Button } from '@dovo/studio-ui'
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
        if (current) setError(String(error))
      })
    return () => {
      current = false
    }
  }, [request, connected, scope, repository?.id, snapshot?.scopedAgentsSupported])
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
      <p className="text-xs text-muted-foreground">
        Update this environment to configure named agents at all four scopes.
      </p>
    )
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0]
  const local = selected && own.some((entry) => entry.id === selected.id)
  const inheritedSelected = selected && inherited.some((entry) => entry.id === selected.id)
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Providers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Reusable configurations. Select a provider to configure it at this target.
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
          <Plus size={14} /> Add provider
        </Button>
      </div>
      <div className="grid overflow-hidden rounded-xl border md:max-h-[calc(100dvh-15rem)] md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label="Provider configurations"
          className="border-b bg-muted/10 md:overflow-y-auto md:border-b-0 md:border-r"
        >
          {agents.map((agent) => {
            const local = own.some((entry) => entry.id === agent.id)
            const origin = origins.find((entry) => entry.agent.id === agent.id)?.scope
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
                className={`flex w-full items-start gap-3 border-b p-4 text-left transition-colors hover:bg-muted/50 ${selected?.id === agent.id ? 'bg-accent' : ''}`}
              >
                <AgentAvatar
                  provider={agent.provider}
                  customIcon={agent.icon}
                  className="mt-0.5 size-6 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{agent.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {providers[agent.provider].short ?? providers[agent.provider].name} ·{' '}
                    {modelDisplayName(agent.model) || 'Provider default'}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {local
                      ? settingsScopeLabels[scope]
                      : `Inherited · ${origin ? settingsScopeLabels[origin] : 'Earlier scope'}`}
                  </span>
                </span>
              </button>
            )
          })}
          {!agents.length && (
            <p className="p-4 text-xs text-muted-foreground">
              {settings ? 'No provider configurations yet.' : 'Loading configurations…'}
            </p>
          )}
        </nav>
        <div className="min-w-0 p-4 md:overflow-y-auto lg:p-6">
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
                        .catch((error: unknown) => setError(String(error)))
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
                      variant="ghost"
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
                          .then(() => setNotice(''))
                          .catch((error: unknown) => setError(String(error)))
                      }}
                    >
                      {inheritedSelected ? 'Reset' : 'Delete'}
                    </Button>
                  )}
                </div>
              </div>
              {!local && (
                <p className="mb-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  Saving creates an override at {settingsScopeLabels[scope]}. Reset it to use the
                  inherited configuration.
                </p>
              )}
              <AgentEditor
                key={JSON.stringify(selected)}
                initial={selected}
                creating={false}
                inline
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
                <summary className="cursor-pointer">Provider diagnostics</summary>
                <ProviderCheck
                  key={JSON.stringify(selected)}
                  agent={selected}
                  repositoryId={repository?.id}
                  settingsScope={scope}
                />
              </details>
            </>
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
        <p role="alert" className="text-xs text-destructive">
          {error}
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
