import { clientScopeKey, useLinearConnections, useLinearKeySettings } from '@dovo/studio-core'
import { projectDisplayName, type LinearConnections } from '@dovo/protocol'
import { View } from 'react-native'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { SettingsField, SettingsAction, SettingsChoice } from '../../screens/settings-controls'
import { SettingsGroup } from '../../screens/settings-group'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function LinearKeySettings() {
  const { connection, snapshot } = useRuntime()
  return (
    <LinearSettingsForm
      key={clientScopeKey(connection)}
      connections={snapshot?.linearConnections}
    />
  )
}

function LinearSettingsForm({ connections }: { connections?: LinearConnections }) {
  const { snapshot, connected, call } = useRuntime()
  const settings = useLinearKeySettings(snapshot?.linearKeySource, call)
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  if (settings.source === undefined) return null
  const disabled = !connected || settings.busy
  return (
    <SettingsGroup title="Linear">
      <Text style={styles.muted}>
        {settings.source === 'saved'
          ? uiText('A Linear API key is saved on this computer.')
          : settings.source === 'environment'
            ? uiText('This computer uses a Linear API key from its environment.')
            : uiText('Add a read-only Linear API key to browse issues.')}
      </Text>
      <SettingsField
        label={uiText('Linear API key')}
        value={settings.key}
        onChangeText={settings.setKey}
        editable={!disabled}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={512}
      />
      <SettingsAction
        label={settings.source === 'saved' ? uiText('Replace key') : uiText('Save key')}
        disabled={disabled || !settings.key.trim()}
        onPress={() => void settings.change('save')}
      />
      {settings.source === 'saved' && (
        <SettingsAction
          label={uiText('Remove key')}
          disabled={disabled}
          secondary
          onPress={() => void settings.change('remove')}
        />
      )}
      {!!settings.message && <Text accessibilityLiveRegion="polite">{settings.message}</Text>}
      {!!settings.error && <Text accessibilityRole="alert">{settings.error}</Text>}
      {connections && <LinearConnectionsForm snapshot={connections} />}
    </SettingsGroup>
  )
}

function LinearConnectionsForm({ snapshot }: { snapshot: LinearConnections }) {
  const { call, connected, snapshot: runtime } = useRuntime()
  const uiText = useInterfaceText()
  const editor = useLinearConnections(snapshot, call)
  const disabled = !connected || editor.busy
  const projects =
    runtime?.workspace.repositories.filter((project) => project.kind !== 'scratch') ?? []
  return (
    <View style={{ gap: 10 }}>
      <SettingsChoice
        label={uiText('Named Linear connection')}
        value={editor.edit?.id ?? ''}
        items={[{ id: '', name: uiText('Add a connection') }, ...editor.state.connections]}
        disabled={disabled}
        onChange={editor.selectConnection}
      />
      <SettingsField
        label={uiText('Connection name')}
        value={editor.name}
        maxLength={80}
        editable={!disabled}
        onChangeText={editor.setName}
      />
      <SettingsField
        label={uiText('Connection API key')}
        value={editor.apiKey}
        maxLength={512}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        onChangeText={editor.setApiKey}
      />
      <SettingsAction
        label={uiText('Save connection')}
        disabled={disabled || !editor.name.trim() || !editor.apiKey.trim()}
        onPress={() => void editor.save()}
      />
      {editor.edit && (
        <SettingsAction
          label={uiText('Remove connection')}
          secondary
          disabled={disabled}
          onPress={() => void editor.remove()}
        />
      )}
      {projects.length > 0 && editor.state.connections.length > 0 && (
        <>
          <SettingsChoice
            label={uiText('Project for Linear issues')}
            value={editor.project}
            items={[
              { id: '', name: uiText('Select a project') },
              ...projects.map((project) => ({ id: project.id, name: projectDisplayName(project) })),
            ]}
            disabled={disabled}
            onChange={editor.selectProject}
          />
          {editor.project && (
            <>
              <SettingsChoice
                label={uiText('Project Linear connection')}
                value={editor.connectionId}
                items={[
                  { id: '', name: uiText('Select a connection') },
                  ...editor.state.connections,
                ]}
                disabled={disabled}
                onChange={editor.setConnectionId}
              />
              <SettingsField
                label={uiText('Linear team key')}
                placeholder="ENG"
                maxLength={40}
                value={editor.team}
                editable={!disabled}
                onChangeText={editor.setTeam}
              />
              <SettingsAction
                label={uiText('Save project binding')}
                disabled={disabled || !editor.connectionId || !editor.team.trim()}
                onPress={() => void editor.bind()}
              />
              {editor.projectRevision && (
                <SettingsAction
                  label={uiText('Remove project binding')}
                  secondary
                  disabled={disabled}
                  onPress={() => void editor.unbind()}
                />
              )}
            </>
          )}
        </>
      )}
      {!!editor.error && <Text accessibilityRole="alert">{editor.error}</Text>}
    </View>
  )
}
