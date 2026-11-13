import { Image, View } from 'react-native'
import { Icon } from '../ui/controls/icon'
import { useTheme } from '../ui/theme'

export function BotAvatar({
  avatar,
  name,
  size = 56,
  round = false,
}: {
  avatar?: string
  name: string
  size?: number
  round?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : size * 0.28,
        overflow: 'hidden',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {avatar ? (
        <Image
          source={{ uri: avatar }}
          accessibilityLabel={`${name} avatar`}
          style={{ width: size, height: size }}
        />
      ) : (
        <Icon name="bot" size={size * 0.48} color={colors.muted} />
      )}
    </View>
  )
}
