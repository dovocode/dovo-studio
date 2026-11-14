import { InterfaceText } from '@dovo/studio-core/interface-language'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskEmptyState({
  startModes,
  projectName,
}: {
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
          fontSize: 20,
          lineHeight: 26,
          fontWeight: '500',
          letterSpacing: -0.4,
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        <InterfaceText>{'What would you like to work on?'}</InterfaceText>
      </Text>
      {projectName && !startModes && (
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 420, fontSize: 12 }]}>
          <InterfaceText values={{ value0: projectName }}>{'In {value0}'}</InterfaceText>
        </Text>
      )}
      {startModes}
    </View>
  )
}
