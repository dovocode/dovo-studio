import { Button, Divider, Host, Image, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { isSnoozed, latestCompletedTaskTurn } from '@dovo/protocol'
import { colors } from '../ui/theme'
import { snoozeOptions } from './use-task-lifecycle'
import type { TaskRowMenuProps } from './task-row-menu'

export function TaskRowMenu({
  task,
  actions,
  testID,
  disabled,
  onOpen,
  onDetails,
}: TaskRowMenuProps) {
  const unavailable = !actions.enabled || actions.busy
  return (
    <Host
      ignoreSafeArea="all"
      colorScheme="dark"
      style={{ width: 44, height: 44, alignSelf: 'center', flexShrink: 0 }}
    >
      <Menu
        testID={testID}
        label={
          <Image
            systemName="ellipsis"
            size={18}
            color={colors.muted}
            modifiers={[frame({ width: 20, height: 20 })]}
          />
        }
        modifiers={[
          buttonStyle('plain'),
          frame({ width: 44, height: 44 }),
          contentShape(shapes.circle(), ['interaction', 'accessibility']),
          accessibilityLabel(`Actions for ${task.title}`),
          disabledModifier(disabled || actions.busy),
        ]}
      >
        {!actions.onCurrentRuntime && (
          <Button label="Open task" systemImage="bubble.left" onPress={onOpen} />
        )}
        <Button
          testID="Task menu details"
          label="Task details"
          systemImage="info.circle"
          onPress={onDetails}
        />
        {!task.archived && latestCompletedTaskTurn(task) && (
          <>
            <Divider />
            <Button
              testID="Task menu read status"
              label={actions.unread ? 'Mark read' : 'Mark unread'}
              systemImage={actions.unread ? 'envelope.open' : 'envelope.badge'}
              modifiers={[disabledModifier(!actions.readStateEnabled || actions.busy)]}
              onPress={actions.toggleRead}
            />
          </>
        )}
        {actions.onCurrentRuntime && (
          <>
            <Divider />
            <Button
              testID="Task menu pin"
              label={task.pinned ? 'Unpin task' : 'Pin task'}
              systemImage={task.pinned ? 'pin.slash' : 'pin'}
              modifiers={[disabledModifier(unavailable)]}
              onPress={actions.togglePinned}
            />
            {!task.archived &&
              (isSnoozed(task, Date.now()) ? (
                <Button
                  testID="Task menu unsnooze"
                  label="Unsnooze"
                  systemImage="clock"
                  modifiers={[disabledModifier(unavailable)]}
                  onPress={() => actions.snooze(null)}
                />
              ) : (
                <Menu
                  testID="Task menu snooze"
                  label="Snooze"
                  systemImage="clock"
                  modifiers={[disabledModifier(unavailable)]}
                >
                  {snoozeOptions.map((option) => (
                    <Button
                      key={option.hours}
                      testID={`Task menu ${option.label}`}
                      label={option.label}
                      onPress={() =>
                        actions.snooze(new Date(Date.now() + option.hours * 3600000).toISOString())
                      }
                    />
                  ))}
                </Menu>
              ))}
            <Button
              testID="Task menu settle"
              label={task.archived ? 'Reopen task' : 'Settle task'}
              systemImage={task.archived ? 'arrow.uturn.backward' : 'checkmark'}
              modifiers={[disabledModifier(unavailable || task.status === 'running')]}
              onPress={actions.toggleSettled}
            />
          </>
        )}
      </Menu>
    </Host>
  )
}
