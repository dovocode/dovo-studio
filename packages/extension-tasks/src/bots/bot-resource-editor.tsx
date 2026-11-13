import { useState } from 'react'
import {
  applyBotResources,
  botResourcesSchema,
  decode,
  type BotResources,
  type ManagedSkill,
  type McpServer,
  type ResourceSettings,
} from '@dovo/protocol'
import { Button, Switch } from '@dovo/studio-ui'
import { CatalogPicker, McpEditor, SkillEditor } from '@dovo/studio-ui/resource-editors'

type Editing =
  | { kind: 'mcp'; value?: McpServer; notes?: string[] }
  | { kind: 'skill'; value?: ManagedSkill }

/** Edits only the supplied Bot layer. Inherited definitions are copied before an override. */
export function BotResourceEditor({
  value,
  inherited,
  disabled,
  onChange,
  kind,
}: {
  kind?: 'mcp' | 'skill'
  value: BotResources
  inherited: ResourceSettings
  disabled: boolean
  onChange: (value: BotResources) => Promise<void>
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<'mcp' | 'skill' | null>(null)
  const change = async (next: BotResources) => {
    setError('')
    try {
      await onChange(decode(botResourcesSchema, next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
  }
  const act = (next: BotResources) => {
    void change(next).catch(() => {
      /* Shown below. */
    })
  }
  const effective = applyBotResources(inherited, { resources: value })
  return (
    <section className="grid gap-3" aria-label="Bot resources">
      <h2 className="font-semibold">
        {kind === 'mcp' ? 'MCP servers' : kind === 'skill' ? 'Skills' : 'MCP servers and skills'}
      </h2>
      <p className="text-xs text-muted-foreground">
        Changes apply only to this Bot from its next turn. Shared settings stay unchanged. Bot
        resources stay when you change harness. Installed harnesses can also use their own native or
        global tools and skills.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {kind !== 'skill' && (
        <>
          <h3 className="font-medium">MCP servers</h3>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setCatalog('mcp')}>
            Browse MCP Registry
          </Button>
          {effective.mcpServers.map((server) => {
            const own = value.mcpServers.some((item) => item.name === server.name)
            const overrides = inherited.mcpServers.some((item) => item.name === server.name)
            return (
              <div key={server.name} className="grid gap-2 rounded border p-2">
                <span className="break-words">
                  {server.name}{' '}
                  <small className="text-muted-foreground">
                    {own ? (overrides ? 'Replaces inherited' : 'This Bot') : 'Inherited'}
                  </small>
                </span>
                <Switch
                  aria-label={`Enable Bot MCP ${server.name}`}
                  disabled={disabled}
                  checked={server.enabled}
                  onCheckedChange={(enabled) =>
                    act(
                      own
                        ? {
                            ...value,
                            mcpServers: value.mcpServers.map((item) =>
                              item.name === server.name ? { ...item, enabled } : item,
                            ),
                          }
                        : {
                            ...value,
                            ...(enabled &&
                            !inherited.mcpServers.find((item) => item.name === server.name)?.enabled
                              ? { mcpServers: [...value.mcpServers, { ...server, enabled: true }] }
                              : {}),
                            disabledMcpServers: enabled
                              ? value.disabledMcpServers.filter((name) => name !== server.name)
                              : [
                                  ...value.disabledMcpServers.filter(
                                    (name) => name !== server.name,
                                  ),
                                  server.name,
                                ],
                          },
                    )
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setEditing({ kind: 'mcp', value: server })}
                  >
                    {own ? 'Edit' : 'Override'} MCP {server.name}
                  </Button>
                  {own && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        act({
                          ...value,
                          mcpServers: value.mcpServers.filter((item) => item.name !== server.name),
                        })
                      }
                    >
                      {overrides ? 'Use inherited' : 'Remove'} MCP {server.name}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setEditing({ kind: 'mcp' })}
          >
            Add Bot MCP server
          </Button>
        </>
      )}
      {kind !== 'mcp' && (
        <>
          <h3 className="font-medium">Skills</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setCatalog('skill')}
          >
            Browse skills.sh
          </Button>
          {effective.skills.map((skill) => {
            const own = value.skills.some((item) => item.name === skill.name)
            const overrides = inherited.skills.some((item) => item.name === skill.name)
            return (
              <div key={skill.name} className="grid gap-2 rounded border p-2">
                <span className="break-words">
                  {skill.name}{' '}
                  <small className="text-muted-foreground">
                    {own ? (overrides ? 'Replaces inherited' : 'This Bot') : 'Inherited'}
                  </small>
                </span>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
                <Switch
                  aria-label={`Enable Bot skill ${skill.name}`}
                  disabled={disabled}
                  checked={skill.enabled}
                  onCheckedChange={(enabled) =>
                    act(
                      own
                        ? {
                            ...value,
                            skills: value.skills.map((item) =>
                              item.name === skill.name ? { ...item, enabled } : item,
                            ),
                          }
                        : {
                            ...value,
                            ...(enabled &&
                            !inherited.skills.find((item) => item.name === skill.name)?.enabled
                              ? { skills: [...value.skills, { ...skill, enabled: true }] }
                              : {}),
                            disabledSkills: enabled
                              ? value.disabledSkills.filter((name) => name !== skill.name)
                              : [
                                  ...value.disabledSkills.filter((name) => name !== skill.name),
                                  skill.name,
                                ],
                          },
                    )
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setEditing({ kind: 'skill', value: skill })}
                  >
                    {own ? 'Edit' : 'Override'} skill {skill.name}
                  </Button>
                  {own && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        act({
                          ...value,
                          skills: value.skills.filter((item) => item.name !== skill.name),
                        })
                      }
                    >
                      {overrides ? 'Use inherited' : 'Remove'} skill {skill.name}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setEditing({ kind: 'skill' })}
          >
            Add Bot skill
          </Button>
        </>
      )}
      {editing?.kind === 'mcp' && (
        <McpEditor
          initial={editing.value}
          notes={editing.notes}
          scope="This Bot only"
          onClose={() => setEditing(null)}
          onSave={async (server) => {
            if (
              value.mcpServers.some(
                (item) => item.name === server.name && item.name !== editing.value?.name,
              )
            )
              throw Error('An MCP server with this name already exists for this Bot.')
            await change({
              ...value,
              mcpServers: [
                ...value.mcpServers.filter((item) => item.name !== editing.value?.name),
                server,
              ],
            })
            setEditing(null)
          }}
        />
      )}
      {catalog && (
        <CatalogPicker
          kind={catalog}
          scope="This Bot only"
          onClose={() => setCatalog(null)}
          onServer={(server, notes) => {
            setCatalog(null)
            setEditing({ kind: 'mcp', value: server, notes })
          }}
          onSkill={(skill) => {
            setCatalog(null)
            setEditing({ kind: 'skill', value: skill })
          }}
          onSkills={async (skills) => {
            if (disabled) throw Error('Reconnect this computer before saving.')
            const duplicates = skills.find((skill) =>
              value.skills.some((item) => item.name === skill.name),
            )
            if (duplicates)
              throw Error(
                `A skill named ${duplicates.name} already exists for this Bot. Edit or remove it before importing.`,
              )
            await change({ ...value, skills: [...value.skills, ...skills] })
            setCatalog(null)
          }}
        />
      )}
      {editing?.kind === 'skill' && (
        <SkillEditor
          initial={editing.value}
          scope="This Bot only"
          onClose={() => setEditing(null)}
          onSave={async (skill) => {
            if (
              value.skills.some(
                (item) => item.name === skill.name && item.name !== editing.value?.name,
              )
            )
              throw Error('A skill with this name already exists for this Bot.')
            await change({
              ...value,
              skills: [...value.skills.filter((item) => item.name !== editing.value?.name), skill],
            })
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}
