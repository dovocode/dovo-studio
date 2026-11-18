import { View, type ViewProps } from 'react-native'
import { useTheme } from '../theme'

export function Surface({ style, tinted = false, ...props }: ViewProps & { tinted?: boolean }) {
  const { colors } = useTheme()
  return (
    <View
      {...props}
      style={[
        { borderWidth: 1, borderColor: colors.border },
        style,
        { backgroundColor: tinted ? colors.selection : colors.surface, shadowOpacity: 0 },
      ]}
    />
  )
}
