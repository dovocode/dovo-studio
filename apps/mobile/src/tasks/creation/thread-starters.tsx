import { THREAD_STARTERS } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'

const icons = { build: 'code', fix: 'search', understand: 'fileText', plan: 'checklist' } as const

export function ThreadStarters({
  disabled,
  onChoose,
}: {
  disabled?: boolean
  onChoose: (prompt: string) => void
}) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityLabel="Start with a prompt"
      style={{ width: '100%', maxWidth: 360, flexDirection: 'row', flexWrap: 'wrap', gap: 0 }}
    >
      {THREAD_STARTERS.map(({ id, label, prompt }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Adds a starting prompt to your draft without sending it."
          accessibilityState={{ disabled: !!disabled }}
          disabled={disabled}
          onPress={() => onChoose(prompt)}
          style={({ pressed }) => ({
            flexBasis: '45%',
            flexGrow: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: 44,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: pressed ? colors.surface : 'transparent',
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Icon name={icons[id]} size={14} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
}
