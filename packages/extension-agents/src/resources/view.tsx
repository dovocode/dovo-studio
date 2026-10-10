import {
  resolveScopedSettings,
  sharedProjectKey,
  resourceScopeChoices,
  scopeEditorValue,
  scopeEditorDefaults,
  scopedSettingsResultSchema,
  settingsScopeLabels,
  resourceOrigin,
  type SettingsScope,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { resourceError } from './error'
import { Schema } from 'effect'
import { useId, type ReactNode } from 'react'
import { Plus, Pencil, Search, Trash2, Undo2 } from 'lucide-react'
import {
  resourceSettingsSchema,
  useWorkspace,
  type McpServer,
  type ManagedSkill,
  type AgentHook,
  type ResourceSettings,
} from '@dovo/studio-core'
import {
  SettingsScopePage,
  Button,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingSource,
  Switch,
  type SettingOrigin,
} from '@dovo/studio-ui'
import { McpEditor } from './mcp-editor'
import { CatalogPicker } from './catalog-picker'
import { SkillEditor } from './skill-editor'
export default function ResourcesView() {
  return (
    <SettingsScopePage
      title="MCP, skills & hooks"
      description="Tools, reusable instructions and checks available to your agents. Changes apply from the next turn."
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        Entries set at {settingsScopeLabels[selectedScope]} replace inherited entries with the same
        name. Reset an override to use the inherited one again. MCP credentials shared across
        computers must reference environment variables on each computer.
      </p>
      {!scopes.length && (
        <p className="rounded-md border p-4 text-xs text-muted-foreground">
          Add a project or custom agent to manage its resources.
        </p>
      )}
      {scopes.map(({ item, collection, label, scope, repository, namedAgentId }) => {
        const resources = decode(resourceSettingsSchema, item.resources ?? {})
        const total =
          resources.mcpServers.length + resources.skills.length + (resources.hooks?.length ?? 0)
        const title = namedAgentId
          ? `${item.name} profile only`
          : collection === 'settings'
            ? 'All agents'
            : `${label} · ${item.name}`
        const where =
          collection === 'settings' && scope
            ? `${settingsScopeLabels[scope]}${repository ? ` · ${repository.name}` : ''}`
            : undefined
        return (
          <details
            key={`${collection}:${scope ?? 'agent'}:${item.id}`}
            className="rounded-lg border"
            open={(!!scope && !namedAgentId) || total > 0 || undefined}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              {title}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {[
                  where,
                  count(resources.mcpServers.length, 'MCP server'),
                  count(resources.skills.length, 'skill'),
                  count(resources.hooks?.length ?? 0, 'hook'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </summary>
            <ResourceScopeView
              collection={collection}
              id={item.id}
              settingsScope={scope}
              namedAgentId={namedAgentId}
              repositoryId={repository?.id}
            />
          </details>
        )
      })}
    </div>
  )
}
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`
function ResourceScopeView({
  collection,
  id,
  settingsScope,
  repositoryId,
  namedAgentId,
}: {
  namedAgentId?: string
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
          resources: namedAgentId
            ? scopedValue?.agents?.find((agent) => agent.id === namedAgentId)?.resources
            : scopedValue?.resources,
        }
      : workspace[collection].find((item) => item.id === id)
  const scope = item
    ? {
        item,
        collection,
        label: settingsScope
          ? [
              settingsScopeLabels[settingsScope],
              repository?.name,
              namedAgentId &&
                `${scopedValue?.agents?.find((agent) => agent.id === namedAgentId)?.name ?? 'Agent'} profile`,
            ]
              .filter(Boolean)
              .join(' · ')
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
            includeAgents: !!namedAgentId,
            projectKey: sharedProjectKey(repository),
            before: scopedValue ?? {},
            after: namedAgentId
              ? {
                  ...scopedValue,
                  agents: scopedValue?.agents?.map((agent) =>
                    agent.id === namedAgentId ? { ...agent, resources } : agent,
                  ),
                }
              : { ...scopedValue, resources },
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
            revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
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
  const inheritedServers = (inherited?.mcpServers ?? []).filter(
    (server) => !settings.mcpServers.some((item) => item.name === server.name),
  )
  const inheritedSkills = (inherited?.skills ?? []).filter(
    (skill) => !settings.skills.some((item) => item.name === skill.name),
  )
  const disabled = !connected || busy
  const origin = (kind: 'mcpServers' | 'skills' | 'hooks', name: string): SettingOrigin['source'] =>
    resourceOrigin(snapshot?.defaults, repository, settingsScope ?? 'environment', kind, name)
  return (
    <div className="space-y-4 px-4 pb-4">
      {!scope ? (
        <p className="text-sm text-muted-foreground">
          Add a project or custom agent to manage its resources.
        </p>
      ) : (
        <>
          {(error || syncError) && (
            <p role="alert" className="text-xs text-destructive">
              {error || syncError}
            </p>
          )}
          {!connected && (
            <p role="status" className="text-xs text-muted-foreground">
              Connect to this computer to manage resources.
            </p>
          )}
          {busy && (
            <p role="status" className="text-xs text-muted-foreground">
              Saving…
            </p>
          )}
          <ResourceSection
            title="MCP servers"
            description="Tool servers the agent can call: local commands or Streamable HTTP endpoints."
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setCatalog('mcp')}
                >
                  <Search className="size-3" />
                  Browse MCP Registry
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setEditing({ kind: 'mcp' })}
                >
                  <Plus className="size-3" />
                  Add MCP server
                </Button>
              </>
            }
            empty={
              !settings.mcpServers.length && !inheritedServers.length
                ? 'No MCP servers yet.'
                : undefined
            }
          >
            {settings.mcpServers.map((server) => {
              const overrides = !!inherited?.mcpServers.some((entry) => entry.name === server.name)
              return (
                <ResourceRow
                  key={`own:${server.name}`}
                  kind="MCP"
                  name={server.name}
                  detail={server.transport === 'stdio' ? server.command : server.url}
                  enabled={server.enabled}
                  source={settingsScope}
                  overrides={overrides}
                  disabled={disabled}
                  onToggle={(checked) =>
                    act((value) => ({
                      ...value,
                      mcpServers: value.mcpServers.map((item) =>
                        item.name === server.name ? { ...item, enabled: checked } : item,
                      ),
                    }))
                  }
                  onEdit={() => setEditing({ kind: 'mcp', value: server })}
                  onRemove={() =>
                    act((value) => ({
                      ...value,
                      mcpServers: value.mcpServers.filter((item) => item.name !== server.name),
                    }))
                  }
                />
              )
            })}
            {inheritedServers.map((server) => (
              <InheritedRow
                key={`inherited:${server.name}`}
                kind="MCP"
                name={server.name}
                detail={server.transport === 'stdio' ? server.command : server.url}
                enabled={server.enabled}
                source={origin('mcpServers', server.name)}
                disabled={disabled}
                onOverride={() => setEditing({ kind: 'mcp', value: server })}
              />
            ))}
          </ResourceSection>
          <ResourceSection
            title="Skills"
            description="Reusable instructions. Enabled skills are offered to the agent, which applies them when relevant."
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setCatalog('skill')}
                >
                  <Search className="size-3" />
                  Browse skills.sh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setEditing({ kind: 'skill' })}
                >
                  <Plus className="size-3" />
                  Add skill
                </Button>
              </>
            }
            empty={
              !settings.skills.length && !inheritedSkills.length ? 'No skills yet.' : undefined
            }
          >
            {settings.skills.map((skill) => {
              const overrides = !!inherited?.skills.some((entry) => entry.name === skill.name)
              return (
                <ResourceRow
                  key={`own:${skill.name}`}
                  kind="skill"
                  name={skill.name}
                  detail={skill.description}
                  enabled={skill.enabled}
                  source={settingsScope}
                  overrides={overrides}
                  disabled={disabled}
                  onToggle={(checked) =>
                    act((value) => ({
                      ...value,
                      skills: value.skills.map((item) =>
                        item.name === skill.name ? { ...item, enabled: checked } : item,
                      ),
                    }))
                  }
                  onEdit={() => setEditing({ kind: 'skill', value: skill })}
                  onRemove={() =>
                    act((value) => ({
                      ...value,
                      skills: value.skills.filter((item) => item.name !== skill.name),
                    }))
                  }
                />
              )
            })}
            {inheritedSkills.map((skill) => (
              <InheritedRow
                key={`inherited:${skill.name}`}
                kind="skill"
                name={skill.name}
                detail={skill.description}
                enabled={skill.enabled}
                source={origin('skills', skill.name)}
                disabled={disabled}
                onOverride={() => act((value) => ({ ...value, skills: [...value.skills, skill] }))}
              />
            ))}
          </ResourceSection>
          <HookSettings
            hooks={settings.hooks ?? []}
            inherited={inherited?.hooks ?? []}
            scope={settingsScope}
            origin={(name) => origin('hooks', name)}
            disabled={disabled}
            change={act}
          />
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

const hookEvents: readonly { id: AgentHook['event']; name: string }[] = [
  { id: 'before-turn', name: 'Before each turn' },
  { id: 'after-turn', name: 'After each turn' },
]
const hookEventName = (event: AgentHook['event']) =>
  hookEvents.find((entry) => entry.id === event)?.name ?? event

function HookSettings({
  hooks,
  inherited,
  scope,
  origin,
  disabled,
  change,
}: {
  hooks: AgentHook[]
  inherited: readonly AgentHook[]
  scope?: SettingsScope
  origin: (name: string) => SettingOrigin['source']
  disabled: boolean
  change: (update: (value: ResourceSettings) => ResourceSettings) => void
}) {
  const [draft, setDraft] = useApplicationState<AgentHook | null>(null)
  const [previousName, setPreviousName] = useApplicationState<string | null>(null)
  const [validation, setValidation] = useApplicationState('')
  const inheritedHooks = inherited.filter(
    (hook) => !hooks.some((entry) => entry.name === hook.name),
  )
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
    <ResourceSection
      title="Agent loop hooks"
      description="Commands that run in the task checkout before or after each agent turn. If an after-turn check fails, the agent is asked to fix the result, up to two times."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !!draft}
          onClick={() => {
            setPreviousName(null)
            setValidation('')
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
      }
      empty={!hooks.length && !inheritedHooks.length && !draft ? 'No hooks yet.' : undefined}
    >
      {hooks.map((hook) => (
        <ResourceRow
          key={`own:${hook.name}`}
          kind="hook"
          name={hook.name}
          meta={hookEventName(hook.event)}
          detail={hook.command}
          mono
          enabled={hook.enabled}
          source={scope}
          overrides={inherited.some((entry) => entry.name === hook.name)}
          disabled={disabled}
          onToggle={(checked) =>
            change((value) => ({
              ...value,
              hooks: (value.hooks ?? []).map((item) =>
                item.name === hook.name ? { ...item, enabled: checked } : item,
              ),
            }))
          }
          onEdit={() => {
            setPreviousName(hook.name)
            setValidation('')
            setDraft(hook)
          }}
          onRemove={() =>
            change((value) => ({
              ...value,
              hooks: (value.hooks ?? []).filter((item) => item.name !== hook.name),
            }))
          }
        />
      ))}
      {inheritedHooks.map((hook) => (
        <InheritedRow
          key={`inherited:${hook.name}`}
          kind="hook"
          name={hook.name}
          meta={hookEventName(hook.event)}
          detail={hook.command}
          mono
          enabled={hook.enabled}
          source={origin(hook.name)}
          disabled={disabled}
          onOverride={() =>
            change((value) => ({ ...value, hooks: [...(value.hooks ?? []), hook] }))
          }
        />
      ))}
      {draft && (
        <form
          aria-label={previousName ? `Edit hook ${previousName}` : 'New hook'}
          className="space-y-4 border-t bg-muted/20 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <h4 className="text-xs font-semibold">
            {previousName ? `Edit hook · ${previousName}` : 'New hook'}
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name">
              <Input
                autoFocus
                required
                value={draft.name}
                placeholder="lint"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </FormField>
            <FormField label="When">
              <Select
                value={draft.event}
                onValueChange={(value) => {
                  const event = hookEvents.find((entry) => entry.id === value)
                  if (event) setDraft({ ...draft, event: event.id })
                }}
              >
                <SelectTrigger aria-label="When" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hookEvents.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Command">
            <Input
              required
              className="font-mono"
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              placeholder="pnpm lint"
            />
          </FormField>
          <FormField label="Timeout (seconds, 1–600)">
            <Input
              className="w-32"
              type="number"
              min={1}
              max={600}
              value={draft.timeoutSeconds}
              onChange={(event) =>
                setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })
              }
            />
          </FormField>
          {validation && (
            <p role="alert" className="text-xs text-destructive">
              {validation}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null)
                setPreviousName(null)
                setValidation('')
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={disabled}>
              Save hook
            </Button>
          </div>
        </form>
      )}
    </ResourceSection>
  )
}

function ResourceSection({
  title,
  description,
  actions,
  empty,
  children,
}: {
  title: string
  description: string
  actions: ReactNode
  empty?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 basis-60">
          <h3 id={id} className="text-sm font-medium">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {empty && <p className="border-t px-4 py-3 text-xs text-muted-foreground">{empty}</p>}
      {children}
    </section>
  )
}

function ResourceRow({
  kind,
  name,
  meta,
  detail,
  mono = false,
  enabled,
  source,
  overrides,
  disabled,
  onToggle,
  onEdit,
  onRemove,
}: {
  kind: string
  name: string
  meta?: string
  detail: string
  mono?: boolean
  enabled: boolean
  source?: SettingsScope
  overrides: boolean
  disabled: boolean
  onToggle: (checked: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 border-t px-4 py-3">
      <Switch
        aria-label={`Enable ${kind} ${name}`}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">
          {name}
          {meta && <span className="text-xs text-muted-foreground"> · {meta}</span>}
        </p>
        <p
          className={`line-clamp-2 break-words text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}
        >
          {detail}
        </p>
        {source && (
          <div className="mt-1.5">
            <SettingSource label={name} origin={{ source, overridden: true }} />
          </div>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Edit ${kind} ${name}`}
        title="Edit"
        disabled={disabled}
        onClick={onEdit}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={overrides ? `Reset ${kind} ${name} to inherited` : `Remove ${kind} ${name}`}
        title={overrides ? 'Reset to the inherited definition' : `Remove ${kind}`}
        disabled={disabled}
        onClick={onRemove}
      >
        {overrides ? <Undo2 className="size-3.5" /> : <Trash2 className="size-3.5" />}
      </Button>
    </div>
  )
}

function InheritedRow({
  kind,
  name,
  meta,
  detail,
  mono = false,
  enabled,
  source,
  disabled,
  onOverride,
}: {
  kind: string
  name: string
  meta?: string
  detail: string
  mono?: boolean
  enabled: boolean
  source: SettingOrigin['source']
  disabled: boolean
  onOverride: () => void
}) {
  return (
    <div className="flex items-center gap-3 border-t bg-muted/20 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-muted-foreground">
          {name}
          {meta && <span className="text-xs"> · {meta}</span>}
          {!enabled && <span className="text-xs"> · Off</span>}
        </p>
        <p
          className={`line-clamp-2 break-words text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}
        >
          {detail}
        </p>
        <div className="mt-1.5">
          <SettingSource label={name} origin={{ source, overridden: false }} />
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        aria-label={`Override ${kind} ${name}`}
        title="Copy to this level so you can change it here"
        disabled={disabled}
        onClick={onOverride}
      >
        Override
      </Button>
    </div>
  )
}
