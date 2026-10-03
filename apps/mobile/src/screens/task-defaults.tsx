import { ScrollView, View } from 'react-native'
import { ScopedSettings } from '../runtime/preferences/settings-target'
import { TaskDefaultSettings } from '../runtime/preferences/task-default-settings'
import { ScreenHeader } from '../ui/layout/screen-header'
import { styles } from '../ui/theme'

export default function TaskDefaultsScreen() {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Task defaults" />
      <ScopedSettings>
        {({ scope, repository }) => (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TaskDefaultSettings inline scope={scope} repository={repository} />
          </ScrollView>
        )}
      </ScopedSettings>
    </View>
  )
}
