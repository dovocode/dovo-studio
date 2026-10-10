import { ScrollView } from 'react-native'
import { ScopedSettings } from '../runtime/preferences/settings-target'
import { TaskDefaultSettings } from '../runtime/preferences/task-default-settings'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'

export default function TaskDefaultsScreen() {
  const { styles } = useTheme()

  return (
    <SettingsPage>
      <ScreenHeader title="Task defaults" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <ScopedSettings>
          {({ scope, repository }) => (
            <TaskDefaultSettings inline scope={scope} repository={repository} />
          )}
        </ScopedSettings>
      </ScrollView>
    </SettingsPage>
  )
}
