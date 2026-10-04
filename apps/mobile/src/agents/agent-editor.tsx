import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment } from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { selectableAccessModes, supportsAccess } from '@dovo/protocol'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { View } from 'react-native'
import { Sheet } from '../ui/layout/sheet'
import { Text } from '../ui/content/text'
import { agentSchema, providerSchema, type Agent } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
export function AgentEditor({
  original,
  creating,
  onClose,
  onSave,
  scopeLabel,
}: {
  original: Agent
  creating: boolean
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
  scopeLabel?: string
}) {
  const { connected, profile } = useRuntime(),
    { busy, error, act } = useAction(),
    [draft, setDraft] = useApplicationState(original)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(original.env))
  const save = async () => {
    const valid = decode(agentSchema, {
      ...draft,
      env: parseAgentEnvironment(environment),
      name: draft.name.trim(),
    })
    await onSave(valid)
    onClose()
  }
  return (
    <Sheet
      title={`${creating ? 'New' : 'Edit'} agent · ${scopeLabel ?? profile?.name ?? 'Computer'}`}
      busy={busy}
      onClose={onClose}
    >
      <Field
        label="Name"
        editable={!busy}
        value={draft.name}
        onChangeText={(name) =>
          setDraft({
            ...draft,
            name,
          })
        }
      />
      <Choice
        label="Provider"
        disabled={busy}
        value={draft.provider}
        items={providerSchema.literals.map((id) => ({
          id,
          name: id,
        }))}
        onChange={(value) => {
          setDraft(changeAgentProvider(draft, decode(providerSchema, value)))
        }}
      />
      {draft.provider === 'acp' && (
        <AcpRegistry agent={draft} onChange={setDraft} showRegistry={false} />
      )}
      <ModelSettings key={draft.provider} agent={draft} onChange={setDraft} disabled={busy} />
      {draft.provider === 'hermes' && (
        <Text style={styles.muted}>
          Uses Hermes on the runtime computer, including its memory and skills. Configure its
          provider with hermes model. Select its hermes executable to launch the native Hermes
          gateway.
        </Text>
      )}
      {draft.provider !== 'cursor' && (
        <Field
          label={
            draft.provider === 'opencode'
              ? 'Server URL · blank starts OpenCode automatically'
              : 'Executable path · blank uses default'
          }
          value={agentConnectionValue(draft)}
          editable={!busy}
          onChangeText={(endpoint) => setDraft(changeAgentConnection(draft, endpoint))}
        />
      )}
      {draft.provider === 'opencode' && !draft.endpoint.trim() && (
        <Field
          label="OpenCode executable path · optional"
          value={draft.executablePath ?? ''}
          editable={!busy}
          onChangeText={(executablePath) => setDraft({ ...draft, executablePath })}
        />
      )}
      {(draft.provider === 'codex' ||
        draft.provider === 'claude' ||
        draft.provider === 'hermes' ||
        draft.provider === 'copilot') && (
        <Field
          label={
            draft.provider === 'hermes'
              ? 'HERMES_HOME directory'
              : draft.provider === 'copilot'
                ? 'COPILOT_HOME directory'
                : draft.provider === 'codex'
                  ? 'CODEX_HOME directory'
                  : 'CLAUDE_CONFIG_DIR directory'
          }
          value={draft.configDirectory ?? ''}
          onChangeText={(configDirectory) => setDraft({ ...draft, configDirectory })}
          editable={!busy}
        />
      )}
      {draft.provider !== 'cursor' && (draft.provider !== 'opencode' || !draft.endpoint.trim()) && (
        <Field
          label="Arguments · one per line"
          editable={!busy}
          value={(draft.args ?? []).join('\n')}
          onChangeText={(value) =>
            setDraft({
              ...draft,
              args: value.split('\n').filter(Boolean),
            })
          }
          multiline
        />
      )}
      {draft.provider === 'cursor' && (
        <Text style={styles.muted}>
          Runs locally through the Cursor SDK. Set CURSOR_API_KEY on this runtime or use Cursor SDK
          browser login. Cursor desktop login is separate.
        </Text>
      )}
      <>
        <Field
          label="Environment variables · NAME=value per line"
          value={environment}
          onChangeText={setEnvironment}
          editable={!busy}
          multiline
        />
        <Text style={styles.muted}>
          Saved as readable configuration. Keep secrets in the server's environment. Claude flags
          use --name or --name=value.
        </Text>
      </>
      <Choice
        label="Access"
        disabled={busy}
        value={draft.permission}
        items={selectableAccessModes(draft.permission, draft.provider)
          .filter((mode) => supportsAccess(draft.provider, mode.id))
          .map((mode) => ({
            id: mode.id,
            name: mode.name,
          }))}
        onChange={(value) =>
          setDraft({
            ...draft,
            permission: decode(agentSchema.fields.permission, value),
          })
        }
      />
      <Field
        label="Instructions"
        editable={!busy}
        multiline
        value={draft.instructions}
        onChangeText={(instructions) =>
          setDraft({
            ...draft,
            instructions,
          })
        }
        style={[
          styles.input,
          {
            minHeight: 150,
            textAlignVertical: 'top',
          },
        ]}
      />
      <View style={styles.row}>
        <Action
          label="Save agent"
          disabled={
            !connected ||
            busy ||
            !draft.name.trim() ||
            !supportsAccess(draft.provider, draft.permission)
          }
          onPress={() => act(save)}
        />
        <Action secondary label="Cancel" disabled={busy} onPress={onClose} />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
