import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Icon, type IconName } from '../controls/icon'
import { Text } from './text'
import { useTheme } from '../theme'

/** Match the desktop's quiet empty states, with room for large text and recovery actions. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName
  title: string
  description: string
  action?: ReactNode
}) {
  const { colors, styles } = useTheme()
  return (
    <View style={[styles.empty, { width: '100%', gap: 10 }]}>
      <View
        style={{
          width: 48,
          height: 48,
          marginBottom: 6,
          borderRadius: 14,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={24} color={colors.muted} />
      </View>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: 18,
          lineHeight: 24,
          fontWeight: '600',
          textAlign: 'center',
          maxWidth: 384,
        }}
      >
        {title}
      </Text>
      <Text style={[styles.muted, { textAlign: 'center', maxWidth: 384 }]}>{description}</Text>
      {!!action && (
        <View
          style={{
            marginTop: 6,
            maxWidth: '100%',
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {action}
        </View>
      )}
    </View>
  )
}
