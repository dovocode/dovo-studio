import { useState } from 'react'
import { Linking } from 'react-native'
import { Text } from '../ui/text'
import {
  managedSkillSchema,
  mcpServerSchema,
  mcpTestResultSchema,
  type ManagedSkill,
  type McpServer,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export type ResourceSelection =
  | { kind: 'mcp'; value: McpServer; notes?: string[] }
  | { kind: 'skill'; value: ManagedSkill }
export function ResourceEditor({
  editing,
  scope,
  onClose,
  onSave,
}: {
  editing:
    | { kind: 'mcp'; value?: McpServer; notes?: string[] }
    | { kind: 'skill'; value?: ManagedSkill }
  scope: string
  onClose: () => void
  onSave: (selection: ResourceSelection) => Promise<void>
}) {
  const { call, connected } = useRuntime(),
    { act, busy, error } = useAction()
  const [server, setServer] = useState<McpServer>(
    editing.kind === 'mcp' && editing.value
      ? editing.value
      : {
          name: '',
          enabled: true,
          transport: 'stdio',
          command: '',
          args: [],
          url: '',
          env: {},
          headerEnv: {},
          bearerTokenEnv: '',
        },
  )
  const [skill, setSkill] = useState<ManagedSkill>(
    editing.kind === 'skill' && editing.value
      ? editing.value
      : { name: '', description: '', content: '', enabled: true },
  )
  const [args, setArgs] = useState(server.args.join('\n')),
    [env, setEnv] = useState(JSON.stringify(server.env, null, 2)),
    [headers, setHeaders] = useState(JSON.stringify(server.headerEnv, null, 2)),
    [envValues, setEnvValues] = useState(JSON.stringify(server.envValues ?? {}, null, 2)),
    [headerValues, setHeaderValues] = useState(JSON.stringify(server.headerValues ?? {}, null, 2)),
    [path, setPath] = useState(''),
    [result, setResult] = useState('')
  const parseServer = () => {
    const value = mcpServerSchema.parse({
      ...server,
      args: args.split('\n').filter(Boolean),
      env: JSON.parse(env),
      headerEnv: JSON.parse(headers),
      envValues: JSON.parse(envValues),
      headerValues: JSON.parse(headerValues),
    })
    if ([value.url, ...value.args].some((item) => item.includes('__CONFIGURE_')))
      throw new Error('Replace the __CONFIGURE_…__ placeholders before saving or testing.')
    return value
  }
  const value = editing.kind === 'skill' ? skill : server
  return (
    <Sheet title={editing.kind === 'mcp' ? 'MCP server' : 'Skill'} busy={busy} onClose={onClose}>
      <Text style={styles.muted}>{scope}</Text>
      {value.sourceUrl && (
        <Action
          secondary
          label={`Source · ${value.sourceRevision?.slice(0, 12) ?? 'Catalog'}`}
          onPress={() => act(() => Linking.openURL(value.sourceUrl!))}
        />
      )}
      {editing.kind === 'mcp' ? (
        <>
          {editing.notes?.map((note, i) => (
            <Text key={i} style={styles.muted}>
              {note}
            </Text>
          ))}
          <Field
            label="Server name"
            value={server.name}
            editable={!busy}
            onChangeText={(name) => setServer({ ...server, name })}
          />
          <Choice
            label="Transport"
            value={server.transport}
            disabled={busy}
            items={[
              { id: 'stdio', name: 'Local command (stdio)' },
              { id: 'http', name: 'Streamable HTTP' },
            ]}
            onChange={(transport) =>
              setServer({ ...server, transport: transport === 'http' ? 'http' : 'stdio' })
            }
          />
          {server.transport === 'stdio' ? (
            <>
              <Field
                label="Executable"
                value={server.command}
                editable={!busy}
                onChangeText={(command) => setServer({ ...server, command })}
              />
              <Field
                label="Arguments (one per line)"
                multiline
                value={args}
                editable={!busy}
                onChangeText={setArgs}
              />
              <Field
                label="Environment bindings (JSON)"
                multiline
                value={env}
                editable={!busy}
                onChangeText={setEnv}
              />
              <Field
                label="Static environment values (JSON, non-secret)"
                multiline
                value={envValues}
                editable={!busy}
                onChangeText={setEnvValues}
              />
            </>
          ) : (
            <>
              <Field
                label="Server URL"
                value={server.url}
                editable={!busy}
                onChangeText={(url) => setServer({ ...server, url })}
              />
              <Field
                label="Bearer token environment variable"
                value={server.bearerTokenEnv}
                editable={!busy}
                onChangeText={(bearerTokenEnv) => setServer({ ...server, bearerTokenEnv })}
              />
              <Field
                label="Header bindings (JSON)"
                multiline
                value={headers}
                editable={!busy}
                onChangeText={setHeaders}
              />
              <Field
                label="Static header values (JSON, non-secret)"
                multiline
                value={headerValues}
                editable={!busy}
                onChangeText={setHeaderValues}
              />
            </>
          )}
          <Text style={styles.muted}>
            Bindings map names to environment variable names on the runtime host, for example{' '}
            {JSON.stringify({ API_KEY: 'MY_API_KEY' })}. Testing starts the server and lists its
            tools.
          </Text>
          <Action
            secondary
            label="Test connection"
            disabled={busy || !connected}
            onPress={() =>
              act(async () => {
                setResult('')
                const result = await call(
                  '/api/agents/mcp/test',
                  parseServer(),
                  mcpTestResultSchema,
                )
                setResult(`Connected to ${result.server} · ${result.tools.length} tools`)
              })
            }
          />
        </>
      ) : (
        <>
          <Field
            label="SKILL.md path on runtime"
            value={path}
            editable={!busy}
            onChangeText={setPath}
          />
          <Action
            secondary
            label="Import SKILL.md"
            disabled={busy || !connected || !path.trim()}
            onPress={() =>
              act(async () =>
                setSkill(await call('/api/agents/skills/import', { path }, managedSkillSchema)),
              )
            }
          />
          <Field
            label="Skill name"
            value={skill.name}
            editable={!busy}
            onChangeText={(name) => setSkill({ ...skill, name })}
          />
          <Field
            label="When to use"
            value={skill.description}
            multiline
            editable={!busy}
            onChangeText={(description) => setSkill({ ...skill, description })}
          />
          <Field
            label="Skill instructions"
            value={skill.content}
            multiline
            editable={!busy}
            style={[styles.input, { minHeight: 180, textAlignVertical: 'top' }]}
            onChangeText={(content) => setSkill({ ...skill, content })}
          />
          {skill.sourcePath && (
            <Text selectable style={styles.muted}>
              Supporting files: {skill.sourcePath}
            </Text>
          )}
        </>
      )}
      {!!result && <Text style={styles.muted}>{result}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={editing.kind === 'mcp' ? 'Save server' : 'Save skill'}
        disabled={busy || !connected}
        onPress={() =>
          act(() =>
            onSave(
              editing.kind === 'mcp'
                ? { kind: 'mcp', value: parseServer() }
                : { kind: 'skill', value: managedSkillSchema.parse(skill) },
            ),
          )
        }
      />
    </Sheet>
  )
}
