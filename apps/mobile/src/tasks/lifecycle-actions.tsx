import { View } from 'react-native'
import { Text } from '../ui/text'
import { isSnoozed, latestCompletedTaskTurn, type Task } from '@dovo/protocol'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { snoozeOptions, useTaskLifecycle } from './use-task-lifecycle'
export function LifecycleActions({
  task,
  allowReadState = false,
  onDeleted,
}: {
  task: Task
  allowReadState?: boolean
  onDeleted?: () => void
}) {
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
  } = useTaskLifecycle(task, undefined, onDeleted)
  return (
    <View style={{ gap: 10 }}>
      {allowReadState && !task.archived && latestCompletedTaskTurn(task) && (
        <Action
          secondary
          label={unread ? 'Mark read' : 'Mark unread'}
          disabled={!readStateEnabled || busy}
          onPress={toggleRead}
        />
      )}
      <View style={styles.row}>
        <Action
          secondary
          label={task.pinned ? 'Unpin task' : 'Pin task'}
          disabled={!enabled || busy}
          onPress={togglePinned}
        />
        {!task.archivedAt && (
          <Action
            secondary
            label={task.archived ? 'Reopen task' : 'Settle task'}
            disabled={!enabled || busy || task.status === 'running'}
            onPress={toggleSettled}
          />
        )}
      </View>
      {!task.archived && (
        <View style={styles.row}>
          {isSnoozed(task, Date.now()) ? (
            <Action
              secondary
              label="Unsnooze"
              disabled={!enabled || busy}
              onPress={() => snooze(null)}
            />
          ) : (
            <>
              {snoozeOptions.map((item) => (
                <Action
                  key={item.hours}
                  secondary
                  label={item.label}
                  disabled={!enabled || busy}
                  onPress={() => snooze(new Date(Date.now() + item.hours * 3600000).toISOString())}
                />
              ))}
            </>
          )}
        </View>
      )}
      <View style={styles.row}>
        <Action
          secondary
          label={task.archivedAt ? 'Restore thread' : 'Archive thread'}
          disabled={!enabled || busy || task.status === 'running'}
          onPress={toggleArchived}
        />
        <Action
          secondary
          label="Delete thread…"
          disabled={!enabled || busy || task.status === 'running'}
          onPress={deleteThread}
        />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
