import { NativeIcon, NativeMenuButton, NativeIconLabel } from '../../ui/controls/native-icon'
import { Button, Divider, Host, Menu } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { isSnoozed, latestCompletedTaskTurn } from '@dovo/protocol'
import { useTheme } from '../../ui/theme'
import { snoozeOptions } from '../detail/use-task-lifecycle'
import type { TaskRowMenuProps } from './task-row-menu'

export function TaskRowMenu({
  task,
  actions,
  testID,
  disabled,
  onOpen,
  onDetails,
}: TaskRowMenuProps) {
  const { colors, mode: appearanceMode } = useTheme()

  const unavailable = !actions.enabled || actions.busy
  return (
    <Host
      ignoreSafeArea="all"
      colorScheme={appearanceMode}
      style={{ width: 44, height: 44, alignSelf: 'center', flexShrink: 0 }}
    >
      <Menu
        testID={testID}
        label={
          <NativeIcon
            name="more"
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
          <NativeMenuButton label="Open task" icon="chat" onPress={onOpen} />
        )}
        <NativeMenuButton
          testID="Task menu details"
          label="Task details"
          icon="info"
          onPress={onDetails}
        />
        {!task.archived && latestCompletedTaskTurn(task) && (
          <>
            <Divider />
            <NativeMenuButton
              testID="Task menu read status"
              label={actions.unread ? 'Mark read' : 'Mark unread'}
              icon={actions.unread ? 'read' : 'unread'}
              modifiers={[disabledModifier(!actions.readStateEnabled || actions.busy)]}
              onPress={actions.toggleRead}
            />
          </>
        )}
        {actions.onCurrentRuntime && (
          <>
            <Divider />
            <NativeMenuButton
              testID="Task menu pin"
              label={task.pinned ? 'Unpin task' : 'Pin task'}
              icon={task.pinned ? 'unpin' : 'pin'}
              modifiers={[disabledModifier(unavailable)]}
              onPress={actions.togglePinned}
            />
            {!task.archived &&
              (isSnoozed(task, Date.now()) ? (
                <NativeMenuButton
                  testID="Task menu unsnooze"
                  label="Unsnooze"
                  icon="snooze"
                  modifiers={[disabledModifier(unavailable)]}
                  onPress={() => actions.snooze(null)}
                />
              ) : (
                <Menu
                  testID="Task menu snooze"
                  label={<NativeIconLabel title="Snooze" icon="snooze" />}
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
            <NativeMenuButton
              label={task.archivedAt ? 'Restore thread' : 'Archive thread'}
              icon="archive"
              modifiers={[disabledModifier(unavailable || task.status === 'running')]}
              onPress={actions.toggleArchived}
            />
            <NativeMenuButton
              label="Delete thread…"
              icon="trash"
              modifiers={[disabledModifier(unavailable || task.status === 'running')]}
              onPress={actions.deleteThread}
            />
            {!task.archivedAt && (
              <NativeMenuButton
                testID="Task menu settle"
                label={task.archived ? 'Reopen task' : 'Settle task'}
                icon={task.archived ? 'reopen' : 'check'}
                modifiers={[disabledModifier(unavailable || task.status === 'running')]}
                onPress={actions.toggleSettled}
              />
            )}
          </>
        )}
      </Menu>
    </Host>
  )
}
