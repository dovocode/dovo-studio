import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { isSnoozed, latestCompletedTaskTurn, type Task } from '@dovo/protocol'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { chooseSnoozeDuration, useTaskLifecycle } from './use-task-lifecycle'
export function LifecycleActions({
  task,
  allowReadState = false,
  onDeleted,
  runtimeId,
}: {
  task: Task
  allowReadState?: boolean
  onDeleted?: () => void
  runtimeId?: string
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const {
    enabled,
    busy,
    error,
    togglePinned,
    toggleSettled,
    toggleArchived,
    deleteThread,
    snooze,
    readStateEnabled,
    unread,
    toggleRead,
  } = useTaskLifecycle(task, runtimeId, onDeleted)
  return (
    <View style={{ gap: 10 }}>
      {allowReadState && !task.archived && latestCompletedTaskTurn(task) && (
        <Action
          secondary
          label={unread ? uiText('Mark read') : uiText('Mark unread')}
          disabled={!readStateEnabled || busy}
          onPress={toggleRead}
        />
      )}
      <View style={styles.row}>
        <Action
          secondary
          label={
            task.bot
              ? task.pinned
                ? uiText('Unpin Bot')
                : uiText('Pin Bot')
              : task.pinned
                ? uiText('Unpin task')
                : uiText('Pin task')
          }
          disabled={!enabled || busy}
          onPress={togglePinned}
        />
        {!task.bot && !task.archivedAt && (
          <Action
            secondary
            label={task.archived ? uiText('Reopen task') : uiText('Settle task')}
            disabled={!enabled || busy || task.status === 'running'}
            onPress={toggleSettled}
          />
        )}
      </View>
      {!task.bot && !task.archived && (
        <View style={styles.row}>
          {isSnoozed(task, Date.now()) ? (
            <Action
              secondary
              label={uiText('Unsnooze')}
              icon="snooze"
              disabled={!enabled || busy}
              onPress={() => snooze(null)}
            />
          ) : (
            <Action
              secondary
              label={uiText('Snooze')}
              icon="snooze"
              disabled={!enabled || busy}
              onPress={() => chooseSnoozeDuration('Snooze thread', (until) => snooze(until))}
            />
          )}
        </View>
      )}
      {!task.bot && (
        <View style={styles.row}>
          <Action
            secondary
            label={task.archivedAt ? uiText('Restore thread') : uiText('Archive thread')}
            disabled={
              !enabled ||
              busy ||
              task.status === 'running' ||
              // A moved thread is kept for recovery; the destination owns it now.
              (!!task.archivedAt && task.machineHandoff?.state === 'moved')
            }
            onPress={toggleArchived}
          />
          <Action
            destructive
            secondary
            label={uiText('Delete thread…')}
            disabled={
              !enabled ||
              busy ||
              task.status === 'running' ||
              task.machineHandoff?.state === 'preparing'
            }
            onPress={deleteThread}
          />
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
