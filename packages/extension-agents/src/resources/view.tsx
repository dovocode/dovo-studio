import {
  resolveScopedSettings,
  sharedProjectKey,
  resourceScopeChoices,
  scopeEditorValue,
  scopeEditorDefaults,
  scopedSettingsResultSchema,
  settingsScopeLabels,
  type SettingsScope,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { resourceError } from './error'
import { Schema } from 'effect'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  resourceSettingsSchema,
  useWorkspace,
  type McpServer,
  type ManagedSkill,
  type AgentHook,
  type ResourceSettings,
} from '@dovo/studio-core'
import { SettingsScopePage, Button, Checkbox } from '@dovo/studio-ui'
import { McpEditor } from './mcp-editor'
import { CatalogPicker } from './catalog-picker'
import { SkillEditor } from './skill-editor'
export default function ResourcesView() {
  return (
    <SettingsScopePage
      title="Agent resources & hooks"
      description="MCP servers, skills and hooks. Matching names override inherited tools; changes apply on the next turn."
    >
      {({ scope, repository }) => (
        <ComputerResources selectedScope={scope} repositoryId={repository?.id} />
      )}
    </SettingsScopePage>
  )
}
function ComputerResources({
  selectedScope,
  repositoryId,
}: {
  selectedScope: SettingsScope
  repositoryId?: string
}) {
  const { workspace, snapshot } = useWorkspace()
  const scopes = resourceScopeChoices(snapshot?.defaults, workspace).filter(
    (entry) =>
      (entry.scope === selectedScope && entry.repository?.id === repositoryId) ||
      (!entry.scope &&
        (selectedScope === 'environment' || selectedScope === 'environment-project')),
  )
  return (
    <div className="space-y-3">
      {!scopes.length && (
        <p className="text-xs text-muted-foreground">
          Add a project or custom agent to manage its resources.
        </p>
      )}
      {scopes.map(({ item, collection, label, scope, repository }) => {
        const resources = decode(resourceSettingsSchema, item.resources ?? {})
        return (
          <details
            key={`${collection}:${scope ?? 'agent'}:${item.id}`}
            className="rounded-md border"
            open={
              !!scope ||
              resources.mcpServers.length +
                resources.skills.length +
                (resources.hooks?.length ?? 0) >
                0 ||
              undefined
            }
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              {label} · {item.name}
              <span className="ml-3 text-xs font-normal text-muted-foreground">
                {resources.mcpServers.length} MCP · {resources.skills.length} skills ·{' '}
                {resources.hooks?.length ?? 0} hooks
              </span>
            </summary>
            <ResourceScopeView
              collection={collection}
              id={item.id}
              settingsScope={scope}
              repositoryId={repository?.id}
            />
          </details>
        )
      })}
    </div>
  )
}
function ResourceScopeView({
  collection,
  id,
  settingsScope,
  repositoryId,
}: {
  settingsScope?: SettingsScope
  repositoryId?: string
  collection: 'agents' | 'repositories' | 'settings'
  id: string
}) {
  const {
    workspace,
    snapshot,
    request,
    connected,
    syncError,
    refreshRuntime,
    connection,
    runtimes,
  } = useWorkspace()
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
  const repository = workspace.repositories.find((item) => item.id === repositoryId)
  const scopedValue = settingsScope
    ? scopeEditorValue(snapshot?.defaults, repository, settingsScope)
    : undefined
  const item =
    collection === 'settings'
      ? {
          id,
          name: repository?.name ?? settingsScopeLabels[settingsScope ?? 'environment'],
          resources: scopedValue?.resources,
        }
      : workspace[collection].find((item) => item.id === id)
  const scope = item
    ? {
        item,
        collection,
        label: settingsScope
          ? `${settingsScopeLabels[settingsScope]} · ${item.name}`
          : `${collection === 'agents' ? 'Agent' : 'Project'} · ${item.name}`,
      }
    : undefined
  const settings = decode(resourceSettingsSchema, scope?.item.resources ?? {})
  const inherited = settingsScope
    ? resolveScopedSettings(scopeEditorDefaults(snapshot?.defaults), repository, settingsScope)
        .resources
    : undefined
  const change = async (update: (value: ResourceSettings) => ResourceSettings) => {
    if (!scope) throw new Error('Choose a scope')
    setBusy(true)
    setError('')
    try {
      const resources = decode(resourceSettingsSchema, update(settings))
      if (settingsScope) {
        await request(
          '/api/agents/settings/save',
          {
            scope: settingsScope,
            repositoryId,
            projectKey: sharedProjectKey(repository),
            before: scopedValue ?? {},
            after: { ...scopedValue, resources },
          },
          scopedSettingsResultSchema,
        )
      } else {
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
      }
      const owner = runtimes.find(
        (entry) =>
          entry.profile.connection.address === connection?.address &&
          entry.profile.connection.token === connection?.token,
      )
      if (owner)
        await refreshRuntime(owner.profile).catch((error: unknown) =>
          setError(`Saved, but could not refresh these settings. ${resourceError(error)}`),
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
          {settingsScope && (
            <p className="mb-4 text-xs text-muted-foreground">
              Edit entries owned by this scope. Remove an override to inherit its earlier
              definition. Shared MCP credentials must reference host environment variables.
            </p>
          )}
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
          {inherited && (
            <section className="mb-4 space-y-2">
              <h3 className="text-sm font-medium">Inherited tools</h3>
              {inherited.mcpServers
                .filter((server) => !settings.mcpServers.some((item) => item.name === server.name))
                .map((server) => (
                  <Button
                    key={`mcp:${server.name}`}
                    size="sm"
                    variant="ghost"
                    disabled={!connected || busy}
                    onClick={() => setEditing({ kind: 'mcp', value: server })}
                  >
                    Override MCP · {server.name}
                    {server.enabled ? '' : ' · Disabled'}
                  </Button>
                ))}
              {inherited.skills
                .filter((skill) => !settings.skills.some((item) => item.name === skill.name))
                .map((skill) => (
                  <Button
                    key={`skill:${skill.name}`}
                    size="sm"
                    variant="ghost"
                    disabled={!connected || busy}
                    onClick={() => act((value) => ({ ...value, skills: [...value.skills, skill] }))}
                  >
                    Override skill · {skill.name}
                    {skill.enabled ? '' : ' · Disabled'}
                  </Button>
                ))}
            </section>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <HookSettings hooks={settings.hooks ?? []} disabled={!connected || busy} change={act} />
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

function HookSettings({
  hooks,
  disabled,
  change,
}: {
  hooks: AgentHook[]
  disabled: boolean
  change: (update: (value: ResourceSettings) => ResourceSettings) => void
}) {
  const [draft, setDraft] = useApplicationState<AgentHook | null>(null)
  const [previousName, setPreviousName] = useApplicationState<string | null>(null)
  const [validation, setValidation] = useApplicationState('')
  const save = () => {
    if (!draft) return
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(draft.name)) {
      setValidation('Use a name of up to 80 letters, numbers, underscores, or hyphens.')
      return
    }
    if (
      !draft.command.trim() ||
      !Number.isInteger(draft.timeoutSeconds) ||
      draft.timeoutSeconds < 1 ||
      draft.timeoutSeconds > 600
    ) {
      setValidation('Enter a command and a timeout between 1 and 600 seconds.')
      return
    }
    if (hooks.some((hook) => hook.name === draft.name && hook.name !== previousName)) {
      setValidation('Hook names must be unique within this scope.')
      return
    }
    change((value) => ({
      ...value,
      hooks: [...(value.hooks ?? []).filter((hook) => hook.name !== previousName), draft],
    }))
    setDraft(null)
    setPreviousName(null)
    setValidation('')
  }
  return (
    <section className="rounded-md border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Agent loop hooks</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setPreviousName(null)
            setDraft({
              name: '',
              enabled: true,
              event: 'after-turn',
              command: '',
              timeoutSeconds: 120,
            })
          }}
        >
          <Plus className="size-3" /> Add hook
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Run commands in the task checkout. Failed after-turn checks ask the agent to repair the
        result, up to two times.
      </p>
      {hooks.map((hook) => (
        <div key={hook.name} className="flex items-center gap-2 border-t py-2">
          <Checkbox
            aria-label={`Enable hook ${hook.name}`}
            checked={hook.enabled}
            disabled={disabled}
            onCheckedChange={(checked) =>
              change((value) => ({
                ...value,
                hooks: (value.hooks ?? []).map((item) =>
                  item.name === hook.name ? { ...item, enabled: checked === true } : item,
                ),
              }))
            }
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {hook.name} · {hook.event}
            </p>
            <p className="truncate text-xs text-muted-foreground">{hook.command}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit hook ${hook.name}`}
            disabled={disabled}
            onClick={() => {
              setPreviousName(hook.name)
              setDraft(hook)
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove hook ${hook.name}`}
            disabled={disabled}
            onClick={() =>
              change((value) => ({
                ...value,
                hooks: (value.hooks ?? []).filter((item) => item.name !== hook.name),
              }))
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      {draft && (
        <div className="space-y-2 border-t pt-3 text-sm">
          <label className="block">
            Name
            <input
              className="mt-1 w-full rounded border bg-background p-2"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="block">
            When
            <select
              className="mt-1 w-full rounded border bg-background p-2"
              value={draft.event}
              onChange={(event) =>
                setDraft({ ...draft, event: event.target.value as AgentHook['event'] })
              }
            >
              <option value="before-turn">Before each turn</option>
              <option value="after-turn">After each turn</option>
            </select>
          </label>
          <label className="block">
            Command
            <input
              className="mt-1 w-full rounded border bg-background p-2 font-mono"
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              placeholder="pnpm lint"
            />
          </label>
          <label className="block">
            Timeout (seconds)
            <input
              className="mt-1 w-full rounded border bg-background p-2"
              type="number"
              min={1}
              max={600}
              value={draft.timeoutSeconds}
              onChange={(event) =>
                setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })
              }
            />
          </label>
          {validation && (
            <p role="alert" className="text-destructive">
              {validation}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={disabled} onClick={save}>
              Save hook
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null)
                setValidation('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
