import { taskParentReference, resolveThreadRuntime } from '@dovo/protocol'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { useRuntime } from '../../runtime/connection/provider'
import { PairComputer } from '../../runtime/connection/pair-computer'
import { StartupThread } from '../creation/startup-thread'
import { useNavigation } from '../../shell/navigation'
import { taskHref } from '../../shell/task-route'
import { useRouteComputer } from '../../shell/use-route-computer'
import { Action } from '../../ui/controls/action'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { TaskDetail } from './task-detail'

function backToTasks() {
  Keyboard.dismiss()
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

export function TaskRouteScreen() {
  const { colors, styles } = useTheme()

  const params = useLocalSearchParams<{
    runtimeId: string
    taskId: string
    runtimeIdentity?: string
    parentRuntimeIdentity?: string
    parentRuntimeId?: string
    parentTaskId?: string
    parentTitle?: string
    questionId?: string
    draft?: string
  }>()
  // This route owns the draft and its live conversation for the whole screen lifetime.
  // Clearing the creation flag updates the URL, without replacing the page or its composer.
  const [startup] = useState(() => params.draft === 'true')
  const { ready, activeId, profiles, overviews, snapshot, refresh, connected } = useRuntime()
  const { focused } = useNavigation()
  const { busy, error, act } = useAction()
  const [pairing, setPairing] = useState(false)
  const owner = resolveThreadRuntime(params, profiles, overviews)
  const switching = useRouteComputer(owner?.id ?? '')
  useEffect(() => {
    if (ready && focused && owner && owner.id !== params.runtimeId)
      router.setParams({ runtimeId: owner.id })
  }, [ready, focused, owner?.id, params.runtimeId])
  // Never resolve a task ID against another computer's workspace, even during a switch.
  const task =
    owner && activeId === params.runtimeId && owner.id === params.runtimeId
      ? snapshot?.workspace.tasks.find((task) => task.id === params.taskId)
      : undefined
  if (startup)
    return (
      <StartupThread
        taskId={params.taskId}
        runtimeId={params.runtimeId}
        onBrowse={backToTasks}
        onNewThread={() => router.push('/new', { withAnchor: true })}
        onCommit={(runtimeId, taskId) => router.setParams({ runtimeId, taskId, draft: undefined })}
      />
    )
  const savedParent = task
    ? taskParentReference(
        task,
        params.runtimeId,
        snapshot?.workspace.tasks ?? [],
        snapshot?.runtimeId,
        overviews.map((source) => ({
          runtimeId: source.profile.id,
          runtimeIdentity: source.snapshot?.runtimeId,
          tasks: source.snapshot?.workspace.tasks ?? [],
        })),
      )
    : undefined
  const parentRuntime = savedParent?.runtimeIdentity
    ? (profiles.find((profile) => profile.connection.runtimeId === savedParent.runtimeIdentity)
        ?.id ??
      overviews.find((source) => source.snapshot?.runtimeId === savedParent.runtimeIdentity)
        ?.profile.id ??
      (snapshot?.runtimeId === savedParent.runtimeIdentity
        ? params.runtimeId
        : savedParent.runtimeId))
    : savedParent?.runtimeId
  const parent =
    params.parentRuntimeId && params.parentTaskId
      ? {
          runtimeId: params.parentRuntimeId,
          runtimeIdentity: params.parentRuntimeIdentity,
          taskId: params.parentTaskId,
          title: params.parentTitle ?? 'Parent thread',
        }
      : savedParent && parentRuntime
        ? {
            runtimeId: parentRuntime,
            runtimeIdentity: savedParent.runtimeIdentity,
            taskId: savedParent.threadId,
            title: savedParent.title,
          }
        : undefined
  const parentButton = parent ? (
    <Action
      label={`Back to parent · ${parent.title}`}
      secondary
      onPress={() =>
        router.replace(
          taskHref(parent.runtimeId, parent.taskId, undefined, undefined, parent.runtimeIdentity),
        )
      }
    />
  ) : null
  if (task)
    return (
      <TaskDetail
        key={`${params.runtimeId}:${task.id}:${params.questionId ?? ''}`}
        task={task}
        questionId={params.questionId}
        onBack={
          parent
            ? () =>
                router.replace(
                  taskHref(
                    parent.runtimeId,
                    parent.taskId,
                    undefined,
                    undefined,
                    parent.runtimeIdentity,
                  ),
                )
            : backToTasks
        }
        parentNavigation={parentButton}
      />
    )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Task"
        subtitle={owner?.name}
        leading={<Action label="Back" secondary onPress={backToTasks} />}
      />
      {parentButton}
      <View style={styles.content}>
        {!ready ? (
          <ActivityIndicator color={colors.accent} />
        ) : !owner ? (
          <>
            <Text style={styles.title}>Pair computer to open this thread</Text>
            <Text style={styles.muted}>
              Pair the computer running this thread. Your selected thread and parent will be
              preserved; another computer will not open it automatically.
            </Text>
            {!pairing ? (
              <Action label="Pair thread computer" onPress={() => setPairing(true)} />
            ) : (
              <PairComputer />
            )}
            {!params.runtimeIdentity && (
              <>
                <Text style={styles.muted}>
                  This older link has no computer identity. Choose its owning computer after
                  pairing.
                </Text>
                {profiles.map((profile) => (
                  <Action
                    key={profile.id}
                    label={`Open on ${profile.name}`}
                    onPress={() => router.setParams({ runtimeId: profile.id })}
                  />
                ))}
              </>
            )}
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
  const { colors, styles } = useTheme()

  const [id] = useState(randomUUID)
  const { ready, overviews, activeId } = useRuntime()
  const { navigate } = useNavigation()
  const owner =
    overviews.find((entry) => entry.connected && entry.profile.id === activeId) ??
    overviews.find((entry) => entry.connected)
  if (!ready)
    return (
      <>
        <ScreenHeader title="New thread" />
        <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />
      </>
    )
  if (!owner)
    return (
      <View style={styles.content}>
        <ScreenHeader title="New thread" />
        <Text style={styles.title}>Connect a computer</Text>
        <Text style={styles.muted}>A computer needs to be online to start a task.</Text>
        <Action label="Open computer settings" onPress={() => navigate('settings')} />
        <Action label="Back" secondary onPress={backToTasks} />
      </View>
    )
  const href = taskHref(owner.profile.id, id)
  return <Redirect href={{ ...href, params: { ...href.params, draft: 'true' } }} />
}
