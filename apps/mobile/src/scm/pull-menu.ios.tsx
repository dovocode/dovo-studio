import { Button, Divider, Host, Image, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { colors } from '../ui/theme'
import type { PullMenuProps } from './pull-menu'

export function PullMenu(props: PullMenuProps) {
  return (
    <Host ignoreSafeArea="all" colorScheme="dark" style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Menu
        testID="PR actions"
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
          accessibilityLabel('PR actions'),
        ]}
      >
        {props.actions.map((option) => (
          <Button
            key={option.action}
            testID={option.label}
            label={option.label}
            role={option.action === 'close' ? 'destructive' : undefined}
            onPress={() => props.onAction({ action: option.action })}
            modifiers={[disabled(props.actionDisabled)]}
          />
        ))}
        {props.actions.length > 0 && <Divider />}
        <Button
          testID="Start task from PR"
          label="Start task from PR"
          systemImage="plus.bubble"
          onPress={props.onStartTask}
          modifiers={[disabled(props.taskDisabled)]}
        />
        <Button
          testID={`Open on ${props.providerName ?? 'GitHub'}`}
          label={`Open on ${props.providerName ?? 'GitHub'}`}
          systemImage="arrow.up.right.square"
          onPress={props.onOpen}
        />
        <Divider />
        <Button
          testID="Refresh details"
          label="Refresh details"
          systemImage="arrow.clockwise"
          onPress={props.onRefresh}
          modifiers={[disabled(props.refreshDisabled)]}
        />
      </Menu>
    </Host>
  )
}
