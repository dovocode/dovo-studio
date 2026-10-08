import { NativeIcon, NativeMenuButton } from '../../../ui/controls/native-icon'
import { Button, Divider, Host, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../../ui/theme'
import type { PullMenuProps } from './pull-menu'

export function PullMenu(props: PullMenuProps) {
  const { colors, mode: appearanceMode } = useTheme()

  return (
    <Host
      ignoreSafeArea="all"
      colorScheme={appearanceMode}
      style={{ width: 44, height: 44, flexShrink: 0 }}
    >
      <Menu
        testID="PR actions"
        label={
          <NativeIcon
            name="more"
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
        <Menu label="Start task from PR" modifiers={[disabled(props.taskDisabled)]}>
          <NativeMenuButton
            testID="New branch from PR"
            label="New branch from PR"
            icon="newChat"
            onPress={() => props.onStartTask('new-branch')}
          />
          <NativeMenuButton
            testID="Use PR branch"
            label="Use PR branch"
            icon="changes"
            onPress={() => props.onStartTask('pr-branch')}
            modifiers={[disabled(!props.prBranchAvailable)]}
          />
        </Menu>
        <NativeMenuButton
          testID={`Open on ${props.providerName ?? 'GitHub'}`}
          label={`Open on ${props.providerName ?? 'GitHub'}`}
          icon="external"
          onPress={props.onOpen}
        />
        <Divider />
        <NativeMenuButton
          testID="Refresh details"
          label="Refresh details"
          icon="refresh"
          onPress={props.onRefresh}
          modifiers={[disabled(props.refreshDisabled)]}
        />
      </Menu>
    </Host>
  )
}
