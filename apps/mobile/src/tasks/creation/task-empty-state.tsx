import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function TaskEmptyState({
  onBrowse,
  starters,
  projectName,
}: {
  onBrowse?: () => void
  starters?: ReactNode
  projectName?: string
}) {
  const { colors, styles } = useTheme()

  return (
    <View
      testID="Thread start"
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 24,
        paddingHorizontal: 4,
      }}
    >
      <Text
        style={{
          color: colors.muted,
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 1.8,
          textTransform: 'uppercase',
        }}
      >
        A fresh start
      </Text>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: 28,
          lineHeight: 34,
          fontWeight: '600',
          letterSpacing: -0.6,
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        What would you like to work on?
      </Text>
      <Text style={[styles.muted, { textAlign: 'center', maxWidth: 420 }]}>
        {projectName ? `In ${projectName}` : 'An idea, a tricky bug, or something to explore.'}
      </Text>
      {starters && (
        <View style={{ width: '100%', alignItems: 'center', marginTop: 12 }}>{starters}</View>
      )}
      {onBrowse && (
        <View style={{ alignSelf: 'center' }}>
          <Action label="Browse threads" secondary onPress={onBrowse} />
        </View>
      )}
    </View>
  )
}
