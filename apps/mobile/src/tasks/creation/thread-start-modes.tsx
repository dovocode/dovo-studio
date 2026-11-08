import { Icon } from '../../ui/controls/icon'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ThreadStartModes({
  selected,
  disabled,
  onGeneral,
  project,
  server,
  home = false,
}: {
  selected: boolean
  disabled: boolean
  onGeneral: () => void
  project: ReactNode
  server: ReactNode
  home?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityLabel={home ? 'Start a terminal' : 'Start a thread'}
      style={{
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 4,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={home ? 'Start in home folder' : 'Start without a project'}
          accessibilityHint={home ? 'Open a shell in your home folder' : 'Start without a project'}
          accessibilityState={{ selected, disabled }}
          disabled={disabled}
          onPress={onGeneral}
          style={{
            flexDirection: 'row',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            minWidth: 80,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: selected ? colors.accent : colors.border,
            backgroundColor: selected ? colors.selection : 'transparent',
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Icon
            name={home ? 'home' : 'noProject'}
            size={16}
            color={selected ? colors.accent : colors.muted}
          />
          <Text
            style={{
              color: selected ? colors.accent : colors.muted,
              fontSize: 13,
              fontWeight: selected ? '600' : '500',
            }}
          >
            {home ? 'Home folder' : 'No Project'}
          </Text>
          {selected && <Icon name="check" size={14} color={colors.accent} />}
        </Pressable>
        {project}
      </View>
      {server}
    </View>
  )
}
