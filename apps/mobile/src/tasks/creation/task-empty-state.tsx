import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskEmptyState({
  starters,
  startModes,
  projectName,
}: {
  starters?: ReactNode
  startModes?: ReactNode
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
        gap: 8,
        paddingVertical: 16,
        paddingHorizontal: 4,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: 24,
          lineHeight: 29,
          fontWeight: '500',
          letterSpacing: -0.4,
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        What would you like to work on?
      </Text>
      {projectName && !startModes && (
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 420, fontSize: 12 }]}>
          In {projectName}
        </Text>
      )}
      {startModes}
      {starters && (
        <View style={{ width: '100%', alignItems: 'center', marginTop: 4 }}>{starters}</View>
      )}
    </View>
  )
}
