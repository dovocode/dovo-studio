import { router, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { useRuntime } from '../runtime/provider'
import { CreationTarget } from '../runtime/creation-target'
import { useNavigation } from '../shell/navigation'
import { taskHref } from '../shell/task-route'
import { useRouteComputer } from '../shell/use-route-computer'
import { Action } from '../ui/action'
import { ScreenHeader } from '../ui/screen-header'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { NewTask } from './new-task'
import { TaskDetail } from './task-detail'

function backToTasks() {
  Keyboard.dismiss()
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

export function TaskRouteScreen() {
  const params = useLocalSearchParams<{ runtimeId: string; taskId: string }>()
  const { ready, activeId, profiles, snapshot, refresh, connected } = useRuntime()
  const { focused, navigate } = useNavigation()
  const { busy, error, act } = useAction()
  const switching = useRouteComputer(params.runtimeId)
  const owner = profiles.find((profile) => profile.id === params.runtimeId)
  // Never resolve a task ID against another computer's workspace, even during a switch.
  const task =
    activeId === params.runtimeId
      ? snapshot?.workspace.tasks.find((task) => task.id === params.taskId)
      : undefined
  if (task)
    return <TaskDetail key={`${params.runtimeId}:${task.id}`} task={task} onBack={backToTasks} />
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Task"
        subtitle={owner?.name}
        leading={<Action label="Back" secondary onPress={backToTasks} />}
      />
      <View style={styles.content}>
        {!ready ? (
          <ActivityIndicator color={colors.accent} />
        ) : !owner ? (
          <>
            <Text style={styles.title}>Computer unavailable</Text>
            <Text style={styles.muted}>
              This task belongs to a computer that is no longer saved on this device.
            </Text>
            <Action label="Open computer settings" onPress={() => navigate('settings')} />
          </>
        ) : activeId !== owner.id ? (
          <>
            <Text style={styles.title}>Opening on {owner.name}…</Text>
            {switching.error ? (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  {switching.error}
                </Text>
                <Action label="Try again" disabled={!focused} onPress={switching.retry} />
              </>
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>{snapshot ? 'Task unavailable' : 'Loading task…'}</Text>
            <Text style={styles.muted}>
              {snapshot
                ? 'It may have been removed. Return to Tasks or refresh this computer.'
                : 'Waiting for this computer’s workspace. Cached tasks remain available offline.'}
            </Text>
            <Action
              label={connected ? 'Refresh task' : 'Reconnect'}
              disabled={busy || !focused}
              onPress={() => act(refresh)}
            />
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
    </View>
  )
}

export function NewTaskScreen() {
  const { ready, overviews } = useRuntime()
  const { navigate } = useNavigation()
  if (!ready)
    return (
      <>
        <ScreenHeader title="New task" />
        <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />
      </>
    )
  if (!overviews.some((entry) => entry.connected))
    return (
      <View style={styles.content}>
        <ScreenHeader title="New task" />
        <Text style={styles.title}>Connect a computer</Text>
        <Text style={styles.muted}>A computer needs to be online to start a task.</Text>
        <Action label="Open computer settings" onPress={() => navigate('settings')} />
        <Action label="Back" secondary onPress={backToTasks} />
      </View>
    )
  return (
    <>
      <ScreenHeader title="New task" />
      <CreationTarget alwaysChoose title="New task" onClose={backToTasks}>
        {(runtimeId) => (
          <NewTask
            onCancel={backToTasks}
            onCreated={(id) => router.replace(taskHref(runtimeId, id))}
          />
        )}
      </CreationTarget>
    </>
  )
}
