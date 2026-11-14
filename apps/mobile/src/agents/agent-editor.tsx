import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { sharedSettingsIssue } from '@dovo/protocol'
import { SettingsSaveBar } from '../screens/settings-save-bar'
import { SecretEnvironmentEditor } from './secret-environment-editor'
import { secretReferenceIssue, responses } from '@dovo/protocol'
import { settingsChanges } from '@dovo/protocol'
import { useSettingsDraft } from '../runtime/preferences/settings-target'
import { selectPermissionPreset, permissionPolicyLabel } from '@dovo/protocol'
import { runtimeComputerName } from '@dovo/protocol'
import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment, providerDisplayName } from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { selectableAccessModes, supportsAccess } from '@dovo/protocol'
import { PermissionPolicyControls, permissionPolicyUIIssue } from './permission-policy-controls'
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
  shared = false,
}: {
  original: Agent
  creating: boolean
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
  scopeLabel?: string
  fixedProvider?: boolean
  shared?: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { connected, profile, snapshot, call } = useRuntime(),
    { busy, error, act } = useAction(),
    [draft, setDraft] = useApplicationState(original)
  const [showConnection, setShowConnection] = useApplicationState(false)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(original.env))
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(original) ||
    environment !== formatAgentEnvironment(original.env)
  useSettingsDraft(dirty, busy)
  const close = () => {
    if (busy) return
    if (
      JSON.stringify(draft) === JSON.stringify(original) &&
      environment === formatAgentEnvironment(original.env)
    )
      onClose()
    else
      Alert.alert(uiText('Unsaved profile'), uiText('Discard unsaved configuration changes?'), [
        { text: uiText('Keep editing'), style: 'cancel' },
        { text: uiText('Discard'), style: 'destructive', onPress: onClose },
      ])
  }
  const save = async () => {
    const secretIssue = secretReferenceIssue(draft.envSecrets)
    if (secretIssue) throw new Error(secretIssue)
    const issue = permissionPolicyUIIssue(draft, snapshot?.permissionPolicySupported === true)
    if (issue) throw new Error(issue)
    const valid = decode(agentSchema, {
      ...draft,
      env: parseAgentEnvironment(environment),
      name: draft.name.trim(),
    })
    const sharedIssue = shared && sharedSettingsIssue({ agents: [valid] })
    if (sharedIssue) throw new Error(sharedIssue)
    await onSave(valid)
    onClose()
  }
  return (
    <Sheet
      title={uiText('{value0} agent · {value1}', {
        value0: creating ? 'New' : 'Edit',
        value1: scopeLabel ?? runtimeComputerName({ profile, snapshot }),
      })}
      busy={busy}
      onClose={close}
    >
      <Field
        label={uiText('Name')}
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
        label={uiText('Provider')}
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
      {(draft.provider === 'claude' || draft.provider === 'codex') && (
        <>
          <Choice
            label={uiText('Cloud integrations')}
            disabled={busy}
            value={
              draft.cloudIntegrations === undefined ? 'default' : String(draft.cloudIntegrations)
            }
            items={[
              { id: 'default', name: uiText('Provider default') },
              { id: 'true', name: uiText('Enabled') },
              { id: 'false', name: uiText('Disabled') },
            ]}
            onChange={(value) =>
              setDraft({
                ...draft,
                cloudIntegrations: value === 'default' ? undefined : value === 'true',
              })
            }
          />
          <Text style={styles.muted}>
            <InterfaceText
              values={{ value0: draft.provider === 'claude' ? 'Claude' : uiText('ChatGPT') }}
            >
              {
                'Use apps already connected to your {value0} account, such as Google Drive or Slack. Requires account sign-in on the computer running the task. Provider restrictions and tool approvals still apply.'
              }
            </InterfaceText>
          </Text>
        </>
      )}
      <Choice
        label={uiText('Access mode')}
        disabled={busy}
        value={permissionPolicyLabel(draft) === 'Custom' ? 'custom' : draft.permission}
        selectedLabel={uiText(permissionPolicyLabel(draft))}
        items={selectableAccessModes(draft.permission, draft.provider)
          .filter((mode) => supportsAccess(draft.provider, mode.id))
          .map((mode) => ({
            id: mode.id,
            name: uiText(mode.name),
          }))}
        onChange={(value) =>
          setDraft(selectPermissionPreset(draft, decode(agentSchema.fields.permission, value)))
        }
      />
      <PermissionPolicyControls
        value={draft}
        supported={snapshot?.permissionPolicySupported === true}
        disabled={busy || !connected}
        onChange={(policy) => setDraft({ ...draft, ...policy })}
      />
      <Field
        label={uiText('Instructions')}
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
        label={uiText('Connection & account')}
        onPress={() => setShowConnection(!showConnection)}
      />
      {showConnection && (
        <View style={{ gap: 12 }}>
          {shared && (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'Shared profiles use each computer’s installation and login. Use environment-variable names for credentials. Save local paths and literal values at Computer or Project on computer.'
                }
              </InterfaceText>
            </Text>
          )}
          {draft.provider === 'hermes' && (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'Uses Hermes on the runtime computer, including its memory and skills. Configure its provider with hermes model. Select its hermes executable to launch the native Hermes gateway.'
                }
              </InterfaceText>
            </Text>
          )}
          {draft.provider !== 'cursor' && (
            <Field
              label={
                draft.provider === 'opencode'
                  ? uiText('Server URL · blank starts OpenCode automatically')
                  : uiText('Executable path · blank uses default')
              }
              value={agentConnectionValue(draft)}
              editable={!busy}
              onChangeText={(endpoint) => setDraft(changeAgentConnection(draft, endpoint))}
            />
          )}
          {draft.provider === 'opencode' && !draft.endpoint.trim() && (
            <Field
              label={uiText('OpenCode executable path · optional')}
              value={draft.executablePath ?? ''}
              editable={!busy}
              onChangeText={(executablePath) => setDraft({ ...draft, executablePath })}
            />
          )}
          {(draft.provider === 'codex' ||
            draft.provider === 'claude' ||
            draft.provider === 'vibe' ||
            draft.provider === 'hermes' ||
            draft.provider === 'copilot') && (
            <Field
              label={
                draft.provider === 'vibe'
                  ? uiText('VIBE_HOME directory')
                  : draft.provider === 'hermes'
                    ? uiText('HERMES_HOME directory')
                    : draft.provider === 'copilot'
                      ? uiText('COPILOT_HOME directory')
                      : draft.provider === 'codex'
                        ? uiText('CODEX_HOME directory')
                        : uiText('CLAUDE_CONFIG_DIR directory')
              }
              value={draft.configDirectory ?? ''}
              onChangeText={(configDirectory) => setDraft({ ...draft, configDirectory })}
              editable={!busy}
            />
          )}
          {draft.provider !== 'cursor' &&
            (draft.provider !== 'opencode' || !draft.endpoint.trim()) && (
              <Field
                label={uiText('Arguments · one per line')}
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
              <InterfaceText>
                {
                  'Runs locally through the Cursor SDK. Set CURSOR_API_KEY on this runtime or use Cursor SDK browser login. Cursor desktop login is separate.'
                }
              </InterfaceText>
            </Text>
          )}
          <>
            <Field
              label={uiText('Environment variables · NAME=value per line')}
              value={environment}
              onChangeText={setEnvironment}
              editable={!busy}
              multiline
            />
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  "Saved as readable configuration. Keep secrets in the server's environment. Claude flags use --name or --name=value."
                }
              </InterfaceText>
            </Text>
            {snapshot?.secretReferencesSupported && (
              <SecretEnvironmentEditor
                value={draft.envSecrets}
                onChange={(envSecrets) => setDraft({ ...draft, envSecrets })}
                disabled={busy || !connected}
                onRefresh={async () => {
                  await call('/api/agents/secrets/refresh', {}, responses.ok)
                }}
              />
            )}
          </>
        </View>
      )}
      {!creating ? (
        <SettingsSaveBar
          inline
          dirty={dirty}
          saving={busy}
          saveLabel="Save agent"
          changes={settingsChanges(
            { ...original, env: undefined, environment: formatAgentEnvironment(original.env) },
            { ...draft, env: undefined, environment },
          )}
          disabled={
            !connected ||
            !draft.name.trim() ||
            !!permissionPolicyUIIssue(draft, snapshot?.permissionPolicySupported === true) ||
            !supportsAccess(draft.provider, draft.permission)
          }
          onDiscard={() => {
            setDraft(original)
            setEnvironment(formatAgentEnvironment(original.env))
          }}
          onSave={() => act(save)}
        />
      ) : (
        <View style={styles.row}>
          <Action
            wide
            label={uiText('Save agent')}
            disabled={
              !connected ||
              busy ||
              !draft.name.trim() ||
              !!permissionPolicyUIIssue(draft, snapshot?.permissionPolicySupported === true) ||
              !supportsAccess(draft.provider, draft.permission)
            }
            onPress={() => act(save)}
          />
          <Action secondary label={uiText('Cancel')} disabled={busy} onPress={close} />
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
