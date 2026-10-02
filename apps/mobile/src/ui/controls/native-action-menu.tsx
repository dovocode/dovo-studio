import { Host, Menu } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, disabled, frame } from '@expo/ui/swift-ui/modifiers'
import { NativeIcon, NativeMenuButton } from './native-icon'
import type { IconName } from './icon'
import { colors } from '../theme'

export function NativeActionMenu({
  label,
  actions,
}: {
  label: string
  actions: { label: string; icon: IconName; onPress: () => void; disabled?: boolean }[]
}) {
  return (
    <Host ignoreSafeArea="all" colorScheme="dark" style={{ width: 44, height: 44 }}>
      <Menu
        label={<NativeIcon name="more" color={colors.text} />}
        modifiers={[
          buttonStyle('plain'),
          frame({ width: 44, height: 44 }),
          accessibilityLabel(label),
        ]}
      >
        {actions.map((action) => (
          <NativeMenuButton
            key={action.label}
            label={action.label}
            icon={action.icon}
            onPress={action.onPress}
            modifiers={[disabled(action.disabled ?? false)]}
          />
        ))}
      </Menu>
    </Host>
  )
}
