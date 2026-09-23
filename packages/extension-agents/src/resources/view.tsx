import { useApplicationState } from '@dovo/studio-core/state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { resourceError } from './error'
import { Schema } from 'effect'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  resourceSettingsSchema,
  useWorkspace,
  useRuntimeSources,
  WorkspaceScope,
  type McpServer,
  type ManagedSkill,
  type ResourceSettings,
} from '@dovo/studio-core'
import { Button, Checkbox } from '@dovo/studio-ui'
import { McpEditor } from './mcp-editor'
import { CatalogPicker } from './catalog-picker'
import { SkillEditor } from './skill-editor'
export default function ResourcesView() {
  const sources = useRuntimeSources()
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4">
      <h1 className="text-base font-semibold">MCP servers & skills</h1>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
        Resources across all projects and agents. Agent entries override matching project names.
        Changes apply on the next turn.
      </p>
      {!sources.length && (
        <p className="mt-6 text-sm text-muted-foreground">
          Connect a computer to manage its project and agent resources.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {sources.map((source) => (
          <WorkspaceScope key={source.scope} profile={source.profile}>
            <section aria-label={`Resources on ${source.name}`}>
              <h2 className="mb-3 text-sm font-semibold">
                {source.name}{' '}
                <span className="ml-2 font-normal text-muted-foreground">
                  {source.connected ? 'Online' : 'Offline · Saved resources'}
                </span>
              </h2>
              <ComputerResources />
            </section>
          </WorkspaceScope>
        ))}
      </div>
    </section>
  )
}
function ComputerResources() {
  const { workspace } = useWorkspace()
  const scopes = [
    ...workspace.repositories.map((item) => ({
      item,
      collection: 'repositories' as const,
      label: 'Project',
    })),
    ...workspace.agents.map((item) => ({
      item,
      collection: 'agents' as const,
      label: 'Agent',
    })),
  ]
  return (
    <div className="space-y-3">
      {!scopes.length && (
        <p className="text-xs text-muted-foreground">
          Add a project or custom agent to manage its resources.
        </p>
      )}
      {scopes.map(({ item, collection, label }) => {
        const resources = decode(resourceSettingsSchema, item.resources ?? {})
        return (
          <details
            key={`${collection}:${item.id}`}
            className="rounded-md border"
            open={resources.mcpServers.length + resources.skills.length > 0 || undefined}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              {label} · {item.name}
              <span className="ml-3 text-xs font-normal text-muted-foreground">
                {resources.mcpServers.length} MCP · {resources.skills.length} skills
              </span>
            </summary>
            <ResourceScopeView collection={collection} id={item.id} />
          </details>
        )
      })}
    </div>
  )
}
function ResourceScopeView({
  collection,
  id,
}: {
  collection: 'agents' | 'repositories'
  id: string
}) {
  const { workspace, request, connected, syncError } = useWorkspace()
  const [editing, setEditing] = useApplicationState<
    | {
        kind: 'mcp'
        value?: McpServer
        notes?: string[]
        imported?: boolean
      }
    | {
        kind: 'skill'
        value?: ManagedSkill
        imported?: boolean
      }
    | null
  >(null)
  const [catalog, setCatalog] = useApplicationState<'mcp' | 'skill' | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const item = workspace[collection].find((item) => item.id === id)
  const scope = item
    ? {
        item,
        collection,
        label: `${collection === 'agents' ? 'Agent' : 'Project'} · ${item.name}`,
      }
    : undefined
  const settings = decode(resourceSettingsSchema, scope?.item.resources ?? {})
  const change = async (update: (value: ResourceSettings) => ResourceSettings) => {
    if (!scope) throw new Error('Choose a scope')
    setBusy(true)
    setError('')
    try {
      const resources = decode(resourceSettingsSchema, update(settings))
      await request(
        '/api/workspace',
        {
          collection: scope.collection,
          id: scope.item.id,
          changes: {
            resources: {
              before: scope.item.resources ?? null,
              after: resources,
            },
          },
        },
        mutableStruct({
          revision: Schema.Number.pipe(Schema.finite()),
        }),
        'PATCH',
      )
    } catch (error) {
      setError(resourceError(error))
      throw error
    } finally {
      setBusy(false)
    }
  }
  const act = (update: (value: ResourceSettings) => ResourceSettings) => {
    void change(update).catch(() => {
      /* The error is displayed above the resource lists. */
    })
  }
  return (
    <div className="px-4 pb-4">
      {!scope ? (
        <p className="text-sm text-muted-foreground">
          Add a project or custom agent to manage its resources.
        </p>
      ) : (
        <>
          {(error || syncError) && (
            <p role="alert" className="mb-4 text-xs text-destructive">
              {error || syncError}
            </p>
          )}
          {!connected && (
            <p className="mb-4 text-xs text-muted-foreground">
              Connect to the runtime to manage resources.
            </p>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-md border p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">MCP servers</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || busy}
                  onClick={() =>
                    setEditing({
                      kind: 'mcp',
                    })
                  }
                >
                  <Plus className="size-3" />
                  Add MCP server
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mb-3"
                disabled={!connected || busy}
                onClick={() => setCatalog('mcp')}
              >
                Browse MCP Registry
              </Button>
              {!settings.mcpServers.length && (
                <p className="text-xs text-muted-foreground">
                  Connect local commands or Streamable HTTP MCP servers.
                </p>
              )}
              {settings.mcpServers.map((server) => (
                <div key={server.name} className="flex items-center gap-3 border-t py-3">
                  <Checkbox
                    aria-label={`Enable MCP ${server.name}`}
                    checked={server.enabled}
                    disabled={!connected || busy}
                    onCheckedChange={(checked) =>
                      act((value) => ({
                        ...value,
                        mcpServers: value.mcpServers.map((item) =>
                          item.name === server.name
                            ? {
                                ...item,
                                enabled: checked === true,
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{server.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {server.transport === 'stdio' ? server.command : server.url}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit MCP ${server.name}`}
                    disabled={!connected || busy}
                    onClick={() =>
                      setEditing({
                        kind: 'mcp',
                        value: server,
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove MCP ${server.name}`}
                    disabled={!connected || busy}
                    onClick={() =>
                      act((value) => ({
                        ...value,
                        mcpServers: value.mcpServers.filter((item) => item.name !== server.name),
                      }))
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </section>
            <section className="rounded-md border p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Skills</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || busy}
                  onClick={() =>
                    setEditing({
                      kind: 'skill',
                    })
                  }
                >
                  <Plus className="size-3" />
                  Add skill
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mb-3"
                disabled={!connected || busy}
                onClick={() => setCatalog('skill')}
              >
                Browse skills.sh
              </Button>
              <p className="mb-3 text-xs text-muted-foreground">
                Enabled skill instructions are supplied to the task harness to apply when relevant.
              </p>
              {settings.skills.map((skill) => (
                <div key={skill.name} className="flex items-center gap-3 border-t py-3">
                  <Checkbox
                    aria-label={`Enable skill ${skill.name}`}
                    checked={skill.enabled}
                    disabled={!connected || busy}
                    onCheckedChange={(checked) =>
                      act((value) => ({
                        ...value,
                        skills: value.skills.map((item) =>
                          item.name === skill.name
                            ? {
                                ...item,
                                enabled: checked === true,
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{skill.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {skill.description}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit skill ${skill.name}`}
                    disabled={!connected || busy}
                    onClick={() =>
                      setEditing({
                        kind: 'skill',
                        value: skill,
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove skill ${skill.name}`}
                    disabled={!connected || busy}
                    onClick={() =>
                      act((value) => ({
                        ...value,
                        skills: value.skills.filter((item) => item.name !== skill.name),
                      }))
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {catalog && (
        <CatalogPicker
          kind={catalog}
          scope={scope?.label ?? ''}
          onClose={() => setCatalog(null)}
          onServer={(server, notes) => {
            setCatalog(null)
            setEditing({
              kind: 'mcp',
              value: server,
              notes,
              imported: true,
            })
          }}
          onSkill={(skill) => {
            setCatalog(null)
            setEditing({
              kind: 'skill',
              value: skill,
              imported: true,
            })
          }}
        />
      )}
      {editing?.kind === 'mcp' && (
        <McpEditor
          notes={editing.notes}
          initial={editing.value}
          scope={scope?.label ?? ''}
          onClose={() => setEditing(null)}
          onSave={async (server) => {
            await change((value) => ({
              ...value,
              mcpServers: [
                ...value.mcpServers.filter(
                  (item) => item.name !== (editing.imported ? undefined : editing.value?.name),
                ),
                server,
              ],
            }))
            setEditing(null)
          }}
        />
      )}
      {editing?.kind === 'skill' && (
        <SkillEditor
          initial={editing.value}
          scope={scope?.label ?? ''}
          onClose={() => setEditing(null)}
          onSave={async (skill) => {
            await change((value) => ({
              ...value,
              skills: [
                ...value.skills.filter(
                  (item) => item.name !== (editing.imported ? undefined : editing.value?.name),
                ),
                skill,
              ],
            }))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
