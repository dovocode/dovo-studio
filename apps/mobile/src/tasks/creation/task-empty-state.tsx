import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function TaskEmptyState({ onBrowse, setup }: { onBrowse?: () => void; setup?: ReactNode }) {
  const { styles } = useTheme()

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 }}>
      <Text style={[styles.title, { textAlign: 'center' }]}>What would you like to work on?</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Describe a change or ask a question.
      </Text>
      {onBrowse && (
        <View style={{ alignSelf: 'center' }}>
          <Action label="Browse tasks" secondary onPress={onBrowse} />
        </View>
      )}
      {setup && <View style={{ width: '100%', maxWidth: 400, marginTop: 8 }}>{setup}</View>}
    </View>
  )
}
