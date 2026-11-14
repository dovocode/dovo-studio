import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  taskParentReference,
  resolveThreadRuntime,
  watchRuntimeTask,
  runtimeSyncOnline,
} from '@dovo/protocol'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
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
import { ReplicatedThread } from './replicated-thread'

function backToTasks() {
  Keyboard.dismiss()
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

type ThreadRouteParams = {
  runtimeId: string
  taskId: string
  runtimeIdentity?: string
  parentRuntimeIdentity?: string
  parentRuntimeId?: string
  parentTaskId?: string
  parentTitle?: string
  nativeAgentKey?: string
  questionId?: string
  draft?: string
}

export function TaskRouteScreen() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const params = useLocalSearchParams<ThreadRouteParams>()
  // Keep creation mounted when committing clears the draft flag in the URL.
  const [startup] = useState(() => params.draft === 'true')
  const { profiles, overviews, activeId, refreshRuntime, recovering } = useRuntime()
  const { focused } = useNavigation()
  const owner = resolveThreadRuntime(params, profiles, overviews)
  // Remember the selected computer in the background. The route can use its cached
  // workspace and owner-bound requests before secure storage finishes.
  const switching = useRouteComputer(owner?.id ?? '')
  useEffect(() => {
    if (!owner || !focused || startup) return
    const stop = watchRuntimeTask(owner.connection, params.taskId)
    // An inactive computer has no selected live stream yet. Load this thread now,
    // including its history, while the selected-computer save is still in progress.
    if (!recovering && owner.id !== activeId && !runtimeSyncOnline(owner.connection))
      // The provider publishes request failures on the owning computer's overview.
      void refreshRuntime(owner).catch(() => undefined)
    return stop
  }, [owner?.connection, focused, startup, params.taskId, activeId, refreshRuntime, recovering])
  const content = <TaskRouteContent startup={startup} />
  return (
    <>
      {!!switching.error && (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.error}>
            <InterfaceText values={{ value0: switching.error }}>
              {'Could not save the selected computer. {value0}'}
            </InterfaceText>
          </Text>
          <Action
            label={uiText('Retry saving computer')}
            disabled={!focused}
            onPress={switching.retry}
          />
        </View>
      )}
      {owner && !startup ? <RuntimeScope runtimeId={owner.id}>{content}</RuntimeScope> : content}
    </>
  )
}

function TaskRouteContent({ startup }: { startup: boolean }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const params = useLocalSearchParams<ThreadRouteParams>()
  const { ready, activeId, profiles, overviews, snapshot, refresh, connected } = useRuntime()
  const { focused } = useNavigation()
  const { busy, error, act } = useAction()
  const [pairing, setPairing] = useState(false)
  const owner = resolveThreadRuntime(params, profiles, overviews)
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
        onDraft={(runtimeId, taskId) => router.setParams({ runtimeId, taskId, draft: 'true' })}
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
          title: params.parentTitle ?? uiText('Parent thread'),
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
      label={uiText('Back to parent · {value0}', { value0: parent.title })}
      secondary
      onPress={() =>
        router.replace(
          taskHref(parent.runtimeId, parent.taskId, undefined, undefined, parent.runtimeIdentity),
        )
      }
    />
  ) : null
  if (task?.replica)
    return (
      <ReplicatedThread key={`${params.runtimeId}:${task.id}`} task={task} onBack={backToTasks} />
    )
  if (task)
    return (
      <TaskDetail
        key={`${params.runtimeId}:${task.id}:${params.questionId ?? ''}:${params.nativeAgentKey ?? ''}`}
        task={task}
        nativeAgentKey={params.nativeAgentKey}
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
        title={uiText('Task')}
        subtitle={owner?.name}
        leading={<Action label={uiText('Back')} secondary onPress={backToTasks} />}
      />
      {parentButton}
      <View style={styles.content}>
        {!ready ? (
          <ActivityIndicator color={colors.accent} />
        ) : !owner ? (
          <>
            <Text style={styles.title}>
              <InterfaceText>{'Pair computer to open this thread'}</InterfaceText>
            </Text>
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'Pair the computer running this thread. Your selected thread and parent will be preserved; another computer will not open it automatically.'
                }
              </InterfaceText>
            </Text>
            {!pairing ? (
              <Action label={uiText('Pair thread computer')} onPress={() => setPairing(true)} />
            ) : (
              <PairComputer />
            )}
            {!params.runtimeIdentity && (
              <>
                <Text style={styles.muted}>
                  <InterfaceText>
                    {
                      'This older link has no computer identity. Choose its owning computer after pairing.'
                    }
                  </InterfaceText>
                </Text>
                {profiles.map((profile) => (
                  <Action
                    key={profile.id}
                    label={uiText('Open on {value0}', { value0: profile.name })}
                    onPress={() => router.setParams({ runtimeId: profile.id })}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>
              {snapshot ? uiText('Task unavailable') : uiText('Loading task…')}
            </Text>
            <Text style={styles.muted}>
              {snapshot
                ? uiText('It may have been removed. Return to Threads or refresh this computer.')
                : uiText(
                    'Waiting for this computer’s workspace. Cached tasks remain available offline.',
                  )}
            </Text>
            <Action
              label={connected ? uiText('Refresh task') : uiText('Reconnect')}
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const [id] = useState(randomUUID)
  const { ready, overviews, activeId } = useRuntime()
  const { navigate } = useNavigation()
  const owner =
    overviews.find((entry) => entry.snapshot && entry.profile.id === activeId) ??
    overviews.find((entry) => entry.connected && entry.snapshot) ??
    overviews.find((entry) => entry.snapshot)
  if (!ready)
    return (
      <>
        <ScreenHeader title={uiText('New thread')} />
        <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />
      </>
    )
  if (!owner)
    return (
      <View style={styles.content}>
        <ScreenHeader title={uiText('New thread')} />
        <Text style={styles.title}>
          <InterfaceText>{'Connect a computer'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Connect once to load a computer’s projects and settings. You can then draft and save messages offline.'
            }
          </InterfaceText>
        </Text>
        <Action label={uiText('Open computer settings')} onPress={() => navigate('settings')} />
        <Action label={uiText('Back')} secondary onPress={backToTasks} />
      </View>
    )
  const href = taskHref(owner.profile.id, id)
  return <Redirect href={{ ...href, params: { ...href.params, draft: 'true' } }} />
}
