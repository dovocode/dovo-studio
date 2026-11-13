import { View } from 'react-native'
import { router } from 'expo-router'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { useNativeBrowser } from '../browser/native-browser'
import { BrowserScreen } from '../browser/browser-screen'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'

export default function ExperimentalBrowserScreen() {
  const preferences = useMobilePreferences()
  return <BrowserRoute enabled={preferences.browserWorkspaceEnabled} />
}

function BrowserRoute({ enabled }: { enabled: boolean }) {
  const { styles } = useTheme()
  const native = useNativeBrowser()
  if (!enabled)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Browser" />
        <View style={[styles.content, { gap: 12 }]}>
          <Text>Experimental Browser is off.</Text>
          {!!native.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {native.error}
            </Text>
          )}
          <Text style={styles.muted}>Enable it in Settings → General → Experimental.</Text>
          <Action label="Open settings" onPress={() => router.push('/settings/general')} />
        </View>
      </View>
    )
  return <BrowserScreen />
}
