import { Button, Host, Image, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { colors } from '../ui/theme'
import type { WorkMenuAction } from './work-menu'
export function WorkMenu({
  actions,
  label = 'Work actions',
}: {
  actions: WorkMenuAction[]
  label?: string
}) {
  return (
    <Host ignoreSafeArea="all" colorScheme="dark" style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Menu
        testID={label}
        label={
          <Image
            systemName="ellipsis"
            color={colors.text}
            size={20}
            modifiers={[frame({ width: 44, height: 44 })]}
          />
        }
        modifiers={[
          buttonStyle('plain'),
          frame({ width: 44, height: 44 }),
          contentShape(shapes.rectangle(), ['interaction', 'accessibility']),
          accessibilityLabel(label),
        ]}
      >
        {actions.map((action) => (
          <Button
            key={action.label}
            testID={action.label}
            label={action.label}
            onPress={action.onPress}
            modifiers={[disabled(action.disabled ?? false)]}
          />
        ))}
      </Menu>
    </Host>
  )
}
