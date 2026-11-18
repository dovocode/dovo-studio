import { View } from 'react-native'
import { Icon } from '../ui/controls/icon'
import { useTheme } from '../ui/theme'

const icons = { thread: 'chat', browser: 'web', terminal: 'terminal' } as const

export function WorkspaceTypeBadge({ kind }: { kind: keyof typeof icons }) {
  const { colors } = useTheme()
  return (
    <View
      accessible={false}
      pointerEvents="none"
      testID={`Workspace type badge ${kind}`}
      style={{
        position: 'absolute',
        bottom: -2,
        right: -3,
        width: 14,
        height: 14,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icons[kind]} size={9} color={colors.text} />
    </View>
  )
}
