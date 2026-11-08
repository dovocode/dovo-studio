import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'
import { retryMobilePreferences, useMobilePreferenceStorage } from './app-preferences'

export function PreferenceStorageNotice() {
  const status = useMobilePreferenceStorage()
  const { styles } = useTheme()
  const { busy, act } = useAction()
  if (!status.error) return null
  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text accessibilityRole="alert" style={styles.error}>
        {status.error}
      </Text>
      <Action
        label="Retry saving preferences"
        secondary
        disabled={busy}
        onPress={() => act(retryMobilePreferences)}
      />
    </View>
  )
}
