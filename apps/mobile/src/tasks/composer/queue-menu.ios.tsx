import { Host, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { NativeIcon, NativeMenuButton } from '../../ui/controls/native-icon'
import { useTheme } from '../../ui/theme'
import type { QueueMenuProps } from './queue-menu'

/** iOS supplies the compact dropdown, dismissal and VoiceOver navigation. */
export function QueueMenu({ label, actions }: QueueMenuProps) {
  const { colors, mode } = useTheme()
  return (
    <Host ignoreSafeArea="all" colorScheme={mode} style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Menu
        testID={label}
        label={<NativeIcon name="more" size={20} color={colors.muted} />}
        modifiers={[
          buttonStyle('plain'),
          frame({ width: 44, height: 44 }),
          contentShape(shapes.circle(), ['interaction', 'accessibility']),
          accessibilityLabel(label),
        ]}
      >
        {actions.map((action) => (
          <NativeMenuButton
            key={action.label}
            testID={action.label}
            label={action.title}
            icon={action.icon}
            modifiers={[disabled(action.disabled), accessibilityLabel(action.label)]}
            onPress={action.onPress}
          />
        ))}
      </Menu>
    </Host>
  )
}
