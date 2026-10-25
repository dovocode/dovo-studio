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
import type { BrowserMenuProps } from './browser-menu'

export function BrowserMenu({ items, onChange }: BrowserMenuProps) {
  const { colors, mode } = useTheme()
  return (
    <Host ignoreSafeArea="all" colorScheme={mode} style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Menu
        testID="Browser options"
        label={<NativeIcon name="more" size={20} color={colors.text} />}
        modifiers={[
          buttonStyle('plain'),
          frame({ width: 44, height: 44 }),
          contentShape(shapes.circle(), ['interaction', 'accessibility']),
          accessibilityLabel('Browser options'),
        ]}
      >
        {items.map((item) => (
          <NativeMenuButton
            key={item.id}
            testID={item.name}
            label={item.name}
            icon={item.icon ?? 'web'}
            modifiers={[disabled(item.disabled ?? false)]}
            onPress={() => onChange(item.id)}
          />
        ))}
      </Menu>
    </Host>
  )
}
