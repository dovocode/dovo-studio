import { useLinearKeySettings } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { SettingsField, SettingsAction } from '../../screens/settings-controls'
import { SettingsGroup } from '../../screens/settings-group'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function LinearKeySettings() {
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
    </SettingsGroup>
  )
}
