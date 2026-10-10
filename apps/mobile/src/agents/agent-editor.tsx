import { runtimeComputerName } from '@dovo/protocol'
import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment, providerDisplayName } from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { selectableAccessModes, supportsAccess } from '@dovo/protocol'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { Alert, View } from 'react-native'
import { SettingsSheet as Sheet } from '../screens/settings-theme'
import { Text } from '../ui/content/text'
import { agentSchema, providerSchema, type Agent } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { useSettingsTheme as useTheme } from '../screens/settings-theme'
import { useAction } from '../ui/controls/use-action'
export function AgentEditor({
  original,
  creating,
  onClose,
  onSave,
  scopeLabel,
  fixedProvider = false,
}: {
  original: Agent
  creating: boolean
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
  scopeLabel?: string
  fixedProvider?: boolean
}) {
  const { styles } = useTheme()

  const { connected, profile, snapshot } = useRuntime(),
    { busy, error, act } = useAction(),
    [draft, setDraft] = useApplicationState(original)
  const [showConnection, setShowConnection] = useApplicationState(false)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(original.env))
  const close = () => {
    if (busy) return
    if (
      JSON.stringify(draft) === JSON.stringify(original) &&
      environment === formatAgentEnvironment(original.env)
    )
      onClose()
    else
      Alert.alert('Unsaved profile', 'Discard unsaved configuration changes?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ])
  }
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
      title={`${creating ? 'New' : 'Edit'} agent · ${scopeLabel ?? runtimeComputerName({ profile, snapshot })}`}
      busy={busy}
      onClose={close}
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
        disabled={busy || fixedProvider}
        value={draft.provider}
        items={providerSchema.literals.map((id) => ({
          id,
          name: providerDisplayName(id),
        }))}
        onChange={(value) => {
          setDraft(changeAgentProvider(draft, decode(providerSchema, value)))
        }}
      />
      {draft.provider === 'acp' && (
        <AcpRegistry agent={draft} onChange={setDraft} showRegistry={false} />
      )}
      <ModelSettings key={draft.provider} agent={draft} onChange={setDraft} disabled={busy} />
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
      <Action
        secondary
        label="Connection & account"
        onPress={() => setShowConnection(!showConnection)}
      />
      {showConnection && (
        <View style={{ gap: 12 }}>
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
          {draft.provider !== 'cursor' &&
            (draft.provider !== 'opencode' || !draft.endpoint.trim()) && (
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
              Runs locally through the Cursor SDK. Set CURSOR_API_KEY on this runtime or use Cursor
              SDK browser login. Cursor desktop login is separate.
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
              Saved as readable configuration. Keep secrets in the server's environment. Claude
              flags use --name or --name=value.
            </Text>
          </>
        </View>
      )}
      <View style={styles.row}>
        <Action
          wide
          label="Save agent"
          disabled={
            !connected ||
            busy ||
            !draft.name.trim() ||
            !supportsAccess(draft.provider, draft.permission)
          }
          onPress={() => act(save)}
        />
        <Action secondary label="Cancel" disabled={busy} onPress={close} />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
