import { View } from 'react-native'
import { Text } from '../ui/text'
import { isSnoozed, latestCompletedTaskTurn, type Task } from '@dovo/protocol'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { snoozeOptions, useTaskLifecycle } from './use-task-lifecycle'
export function LifecycleActions({
  task,
  allowReadState = false,
}: {
  task: Task
  allowReadState?: boolean
}) {
  const {
    enabled,
    busy,
    error,
    togglePinned,
    toggleSettled,
    snooze,
    readStateEnabled,
    unread,
    toggleRead,
  } = useTaskLifecycle(task)
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
        <Action
          secondary
          label={task.archived ? 'Reopen task' : 'Settle task'}
          disabled={!enabled || busy || task.status === 'running'}
          onPress={toggleSettled}
        />
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
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
