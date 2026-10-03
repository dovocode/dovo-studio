import { useEffect } from 'react'
import { Copy, Star } from 'lucide-react'
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
import { useWorkspace } from '@dovo/studio-core'
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
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Named configurations</h2>
        <Button
          size="sm"
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
          New configuration
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Inherited configurations can be overridden here. Reset an override to use the earlier level.
      </p>
      {agents.map((agent) => {
        const local = own.some((entry) => entry.id === agent.id)
        const origin = origins.find((entry) => entry.agent.id === agent.id)?.scope
        return (
          <article key={agent.id} className="flex flex-wrap items-center gap-3 border-t py-3">
            <AgentAvatar
              provider={agent.provider}
              customIcon={agent.icon ?? 'bot'}
              className="size-6"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">
                {local
                  ? settingsScopeLabels[scope]
                  : `Inherited · ${origin ? settingsScopeLabels[origin] : 'Earlier scope'}`}{' '}
                · {modelDisplayName(agent.model) || 'Provider default'}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!connected || busy}
              onClick={() => setEditing(agent)}
            >
              {local ? 'Configure' : 'Override'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Duplicate ${agent.name}`}
              disabled={!connected || busy}
              onClick={() => setEditing({ ...agent, id: randomUUID(), name: `${agent.name} copy` })}
            >
              <Copy size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Favorite ${agent.name}`}
              aria-pressed={!!snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite}
              disabled={!connected || busy}
              onClick={() => {
                setBusy(true)
                void request(
                  '/api/agents/models/preference',
                  {
                    key: `agent:${agent.id}`,
                    favorite:
                      !snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite,
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
                  snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite
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
                    !inherited.some((entry) => entry.id === agent.id) &&
                    !window.confirm(
                      `Delete “${agent.name}”? Existing threads keep their configuration.`,
                    )
                  )
                    return
                  setBusy(true)
                  void save(own.filter((entry) => entry.id !== agent.id))
                    .catch((error: unknown) => setError(String(error)))
                    .finally(() => setBusy(false))
                }}
              >
                {inherited.some((entry) => entry.id === agent.id) ? 'Reset' : 'Delete'}
              </Button>
            )}
            <details className="basis-full text-xs text-muted-foreground">
              <summary className="cursor-pointer">Provider diagnostics</summary>
              <ProviderCheck
                key={JSON.stringify(agent)}
                agent={agent}
                repositoryId={repository?.id}
                settingsScope={scope}
              />
            </details>
          </article>
        )
      })}
      {!agents.length && settings && (
        <p className="text-xs text-muted-foreground">No named configurations at this target.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {editing && (
        <AgentEditor
          initial={editing}
          creating={!agents.some((agent) => agent.id === editing.id)}
          computerName={settingsScopeLabels[scope]}
          onClose={() => setEditing(null)}
          onSave={(agent) => save([...own.filter((entry) => entry.id !== agent.id), agent])}
        />
      )}
    </section>
  )
}
