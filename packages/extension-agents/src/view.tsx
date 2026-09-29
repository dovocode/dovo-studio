import { Setup } from './setup'
import { useApplicationState } from '@dovo/studio-core/state'
import { TitleSettings } from './title-settings'
import { accessLabel } from '@dovo/studio-core'
import { ProviderCheck } from './provider-check'
import { Star, Copy, Trash2, Plus, SlidersHorizontal } from 'lucide-react'
import {
  useWorkspace,
  useRuntimeSources,
  WorkspaceScope,
  providers,
  type Agent,
} from '@dovo/studio-core'
import { responses, defaultTaskHarness, runtimeDefaultsSchema } from '@dovo/protocol'
import { AgentAvatar, Button } from '@dovo/studio-ui'
import { AgentEditor } from './agent-editor'
import { AcpRegistrySettings } from './acp-registry'
export default function AgentsView() {
  const sources = useRuntimeSources()
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <header className="studio-page-header border-b">
        <h1 className="text-lg font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Reusable agents, titles and dictation across your computers.
        </p>
      </header>
      <div className="mx-auto max-w-4xl space-y-5 p-4">
        {!sources.length && (
          <p className="text-sm text-muted-foreground">
            Connect a computer in Devices & runtime to configure agents.
          </p>
        )}
        {sources.map((source) => (
          <WorkspaceScope key={source.scope} profile={source.profile}>
            <ComputerAgents name={source.name} />
          </WorkspaceScope>
        ))}
      </div>
    </section>
  )
}
function ComputerAgents({ name }: { name: string }) {
  const { workspace, snapshot, connected, request, refreshRuntimes } = useWorkspace()
  const [error, setError] = useApplicationState('')
  const [deleting, setDeleting] = useApplicationState('')
  const [editing, setEditing] = useApplicationState<{
    agent: Agent
    creating: boolean
  } | null>(null)
  return (
    <section className="min-w-0" aria-label={`Agents on ${name}`}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <h2 className="text-sm font-semibold">{name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {connected ? 'Online' : 'Offline · Saved agents'}
          </p>
        </div>
        <Button
          size="sm"
          disabled={!connected}
          onClick={() =>
            setEditing({
              creating: true,
              agent: {
                id: crypto.randomUUID(),
                name: '',
                provider: 'codex',
                model: '',
                endpoint: '',
                instructions: '',
                permission: 'ask',
              },
            })
          }
        >
          <Plus size={14} />
          New configuration
        </Button>
      </header>
      <Setup />
      <p className="mb-3 text-xs text-muted-foreground">
        Save multiple configurations for any provider, each with its own model, access and
        instructions.
      </p>
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {[
        ...(['codex', 'claude', 'opencode'] as const).map((provider) => ({
          id: provider,
          name: providers[provider].name,
          provider,
          installationId: undefined,
        })),
        ...(snapshot?.acpInstallations ?? []).map((installation) => ({
          id: installation.id,
          name: installation.name,
          provider: 'acp' as const,
          installationId: installation.id,
        })),
      ].map((installation) => (
        <div
          key={installation.id}
          className="mb-3 flex items-center justify-between rounded-lg border p-3"
        >
          <span className="text-sm">{installation.name}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected}
            onClick={() =>
              setEditing({
                creating: !workspace.agents.some(
                  (agent) =>
                    agent.provider === installation.provider &&
                    agent.acpInstallationId === installation.installationId,
                ),
                agent: workspace.agents.find(
                  (agent) =>
                    agent.provider === installation.provider &&
                    agent.acpInstallationId === installation.installationId,
                ) ?? {
                  ...defaultTaskHarness(installation.provider),
                  id: crypto.randomUUID(),
                  name: installation.name,
                  acpInstallationId: installation.installationId,
                },
              })
            }
          >
            Configure
          </Button>
        </div>
      ))}
      <div className="min-w-0">
        <div className="mx-auto max-w-4xl">
          <div className="divide-y border-y">
            {workspace.agents
              .slice()
              .sort(
                (a, b) =>
                  Number(
                    snapshot?.defaults?.modelPreferences?.[`agent:${b.id}`]?.favorite ?? false,
                  ) -
                  Number(
                    snapshot?.defaults?.modelPreferences?.[`agent:${a.id}`]?.favorite ?? false,
                  ),
              )
              .map((agent) => (
                <article key={agent.id} className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 text-muted-foreground">
                      <AgentAvatar
                        provider={agent.provider}
                        customIcon={agent.icon ?? 'bot'}
                        className="size-6"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-sm font-medium">{agent.name}</h2>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {providers[agent.provider].name}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!connected}
                      aria-label={`Favorite ${agent.name}`}
                      aria-pressed={
                        !!snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite
                      }
                      onClick={() => {
                        setError('')
                        void request(
                          '/api/agents/models/preference',
                          {
                            key: `agent:${agent.id}`,
                            favorite:
                              !snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]
                                ?.favorite,
                          },
                          runtimeDefaultsSchema,
                        )
                          .then(() => refreshRuntimes())
                          .catch((error: unknown) =>
                            setError(error instanceof Error ? error.message : String(error)),
                          )
                      }}
                    >
                      <Star
                        size={13}
                        fill={
                          snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite
                            ? 'currentColor'
                            : 'none'
                        }
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!connected}
                      aria-label={`Duplicate ${agent.name}`}
                      onClick={() =>
                        setEditing({
                          creating: true,
                          agent: { ...agent, id: crypto.randomUUID(), name: `${agent.name} copy` },
                        })
                      }
                    >
                      <Copy size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={!connected || !!deleting}
                      aria-label={`Delete ${agent.name}`}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete configuration “${agent.name}”? Existing threads keep their settings.`,
                          )
                        )
                          return
                        setDeleting(agent.id)
                        setError('')
                        void request('/api/agents/remove', { id: agent.id }, responses.ok)
                          .catch((error: unknown) =>
                            setError(error instanceof Error ? error.message : String(error)),
                          )
                          .finally(() => setDeleting(''))
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!connected}
                      onClick={() =>
                        setEditing({
                          agent,
                          creating: false,
                        })
                      }
                    >
                      <SlidersHorizontal size={13} /> Configure
                    </Button>
                  </div>
                  <p className="my-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {agent.instructions || 'No additional instructions.'}
                  </p>
                  <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-xs">
                    <dt className="text-muted-foreground">Model</dt>
                    <dd className="break-words">
                      {agent.model || 'Provider default'}
                      {agent.reasoning ? ` · ${agent.reasoning}` : ''}
                    </dd>
                    <dt className="text-muted-foreground">Permissions</dt>
                    <dd>{accessLabel(agent.permission)}</dd>
                  </dl>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {connected
                        ? 'Provider diagnostics'
                        : 'Runtime offline · provider diagnostics'}
                    </summary>
                    <ProviderCheck key={JSON.stringify(agent)} agent={agent} />
                  </details>
                </article>
              ))}
          </div>
          <div className="mt-6">
            <AcpRegistrySettings />
          </div>
          <div className="mt-6">
            <TitleSettings />
          </div>
        </div>
      </div>
      {editing && (
        <AgentEditor
          key={editing.agent.id}
          computerName={name}
          initial={editing.agent}
          creating={editing.creating}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
