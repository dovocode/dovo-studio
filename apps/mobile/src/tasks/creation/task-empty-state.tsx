import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function TaskEmptyState({ onBrowse }: { onBrowse?: () => void }) {
  const { styles } = useTheme()

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 }}>
      <Text style={styles.title}>What would you like to work on?</Text>
      <Text style={styles.muted}>Describe a change or ask a question.</Text>
      {onBrowse && <Action label="Browse tasks" secondary onPress={onBrowse} />}
    </View>
  )
}
