import { CredentialEditor } from './credential-editor'
import { credentialFields, credentialValues } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
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
  | {
      kind: 'mcp'
      value: McpServer
      notes?: string[]
    }
  | {
      kind: 'skill'
      value: ManagedSkill
    }
export function ResourceEditor({
  editing,
  scope,
  onClose,
  onSave,
}: {
  editing:
    | {
        kind: 'mcp'
        value?: McpServer
        notes?: string[]
      }
    | {
        kind: 'skill'
        value?: ManagedSkill
      }
  scope: string
  onClose: () => void
  onSave: (selection: ResourceSelection) => Promise<void>
}) {
  const { connected, callEffect } = useRuntime(),
    { act, busy, error, fieldError } = useAction()
  const [server, setServer] = useApplicationState<McpServer>(
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
  const [skill, setSkill] = useApplicationState<ManagedSkill>(
    editing.kind === 'skill' && editing.value
      ? editing.value
      : {
          name: '',
          description: '',
          content: '',
          enabled: true,
        },
  )
  const [args, setArgs] = useApplicationState(server.args.join('\n')),
    [env, setEnv] = useApplicationState(JSON.stringify(server.env, null, 2)),
    [headers, setHeaders] = useApplicationState(JSON.stringify(server.headerEnv, null, 2)),
    [envValues, setEnvValues] = useApplicationState(credentialFields(server.envValues ?? {})),
    [headerValues, setHeaderValues] = useApplicationState(
      credentialFields(server.headerValues ?? {}),
    ),
    [path, setPath] = useApplicationState(''),
    [result, setResult] = useApplicationState('')
  const parseServer = () => {
    const value = decode(mcpServerSchema, {
      ...server,
      args: args.split('\n').filter(Boolean),
      env: JSON.parse(env),
      headerEnv: JSON.parse(headers),
      envValues: credentialValues(envValues),
      headerValues: credentialValues(headerValues),
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
            error={fieldError('name')}
            value={server.name}
            editable={!busy}
            onChangeText={(name) =>
              setServer({
                ...server,
                name,
              })
            }
          />
          <Choice
            label="Transport"
            value={server.transport}
            disabled={busy}
            items={[
              {
                id: 'stdio',
                name: 'Local command (stdio)',
              },
              {
                id: 'http',
                name: 'Streamable HTTP',
              },
            ]}
            onChange={(transport) =>
              setServer({
                ...server,
                transport: transport === 'http' ? 'http' : 'stdio',
              })
            }
          />
          {server.transport === 'stdio' ? (
            <>
              <Field
                label="Executable"
                error={fieldError('command')}
                value={server.command}
                editable={!busy}
                onChangeText={(command) =>
                  setServer({
                    ...server,
                    command,
                  })
                }
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
              <CredentialEditor fields={envValues} onChange={setEnvValues} disabled={busy} />
            </>
          ) : (
            <>
              <Field
                label="Server URL"
                error={fieldError('url')}
                value={server.url}
                editable={!busy}
                onChangeText={(url) =>
                  setServer({
                    ...server,
                    url,
                  })
                }
              />
              <Field
                label="Bearer token environment variable"
                error={fieldError('bearerTokenEnv')}
                value={server.bearerTokenEnv}
                editable={!busy}
                onChangeText={(bearerTokenEnv) =>
                  setServer({
                    ...server,
                    bearerTokenEnv,
                  })
                }
              />
              <Field
                label="Header bindings (JSON)"
                multiline
                value={headers}
                editable={!busy}
                onChangeText={setHeaders}
              />
              <CredentialEditor fields={headerValues} onChange={setHeaderValues} disabled={busy} />
            </>
          )}
          <Text style={styles.muted}>
            Bindings map names to environment variable names on the runtime host, for example{' '}
            {JSON.stringify({
              API_KEY: 'MY_API_KEY',
            })}
            . Testing starts the server and lists its tools.
          </Text>
          <Action
            secondary
            label="Test connection"
            disabled={busy || !connected}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  setResult('')
                  const result = yield* callEffect(
                    '/api/agents/mcp/test',
                    parseServer(),
                    mcpTestResultSchema,
                  )
                  setResult(`Connected to ${result.server} · ${result.tools.length} tools`)
                }),
              )
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
              act(() =>
                mobileWorkflow(function* () {
                  return setSkill(
                    yield* callEffect(
                      '/api/agents/skills/import',
                      {
                        path,
                      },
                      managedSkillSchema,
                    ),
                  )
                }),
              )
            }
          />
          <Field
            label="Skill name"
            error={fieldError('name')}
            value={skill.name}
            editable={!busy}
            onChangeText={(name) =>
              setSkill({
                ...skill,
                name,
              })
            }
          />
          <Field
            label="When to use"
            error={fieldError('description')}
            value={skill.description}
            multiline
            editable={!busy}
            onChangeText={(description) =>
              setSkill({
                ...skill,
                description,
              })
            }
          />
          <Field
            label="Skill instructions"
            error={fieldError('content')}
            value={skill.content}
            multiline
            editable={!busy}
            style={[
              styles.input,
              {
                minHeight: 180,
                textAlignVertical: 'top',
              },
            ]}
            onChangeText={(content) =>
              setSkill({
                ...skill,
                content,
              })
            }
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
                ? {
                    kind: 'mcp',
                    value: parseServer(),
                  }
                : {
                    kind: 'skill',
                    value: decode(managedSkillSchema, skill),
                  },
            ),
          )
        }
      />
    </Sheet>
  )
}
