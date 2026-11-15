import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState, Pressable, View } from 'react-native'
import { router, useGlobalSearchParams, usePathname, useRootNavigationState } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  runtimeComputerName,
  taskInputOwner,
  taskNotificationEvents,
  taskNotificationStates,
  type NotificationTarget,
  type TaskState,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { readMobilePreferences, useMobilePreferences } from '../runtime/preferences/app-preferences'
import { taskHref } from '../shell/task-route'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { registerInAppNotification } from './in-app-delivery'
import { reconcileInputNotices, sameNoticeThread, type InAppInputNotice } from './in-app-notices'

/** One foreground surface, independent of system push permission and without polling. */
export function InAppInputNotifications() {
  const { overviews, ready } = useRuntime()
  const { inAppNotifications: enabled } = useMobilePreferences()
  const { colors, highContrast } = useTheme()
  const uiText = useInterfaceText()
  const insets = useSafeAreaInsets()
  const navigation = useRootNavigationState()
  const pathname = usePathname()
  const params = useGlobalSearchParams<{
    runtimeId?: string
    taskId?: string
    runtimeIdentity?: string
    nativeAgentKey?: string
    questionId?: string
    parentRuntimeId?: string
    parentRuntimeIdentity?: string
    parentTaskId?: string
    parentTitle?: string
  }>()
  const active: NotificationTarget | undefined =
    pathname.startsWith('/thread/') && params.runtimeId && params.taskId
      ? { runtimeId: params.runtimeId, viewId: 'tasks', entityId: params.taskId }
      : undefined
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [notices, setNotices] = useState<InAppInputNotice[]>([])
  const [returnTo, setReturnTo] = useState<{
    href: ReturnType<typeof taskHref>
    destination: NotificationTarget
    title: string
  } | null>(null)
  const previous = useRef<{
    states: Map<string, TaskState>
    runtimes: Set<string>
  } | null>(null)
  const latest = useRef({ overviews, ready, active, navigationReady: !!navigation?.key })
  latest.current = { overviews, ready, active, navigationReady: !!navigation?.key }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active')
    })
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (!enabled || !foreground || !ready) {
      previous.current = null
      setNotices([])
      return
    }
    const states = taskNotificationStates(overviews)
    const before = previous.current
    const baseline = new Map(before?.states)
    // A worker can be created and ask for input within one overview interval. It is a
    // new event on an observed computer, but the first snapshot after reconnect is quiet.
    for (const [key, state] of states)
      if (
        before?.runtimes.has(state.target.runtimeId) &&
        !baseline.has(key) &&
        state.target.viewId === 'tasks' &&
        state.needsInput
      )
        baseline.set(key, { ...state, needsInput: false, inputIds: [] })
    const events = before ? taskNotificationEvents(baseline, states) : []
    previous.current = {
      states,
      runtimes: new Set(
        overviews
          .filter((entry) => entry.connected && entry.snapshot)
          .map((entry) => entry.profile.id),
      ),
    }
    setNotices((pending) => reconcileInputNotices(pending, states, events, active))
  }, [overviews, ready, enabled, foreground, active?.runtimeId, active?.entityId])
  useLayoutEffect(
    () =>
      registerInAppNotification((target) => {
        const current = latest.current
        if (
          !readMobilePreferences().inAppNotifications ||
          !current.ready ||
          !current.navigationReady ||
          AppState.currentState !== 'active' ||
          !current.overviews.some((entry) => entry.profile.id === target.runtimeId)
        )
          return false
        const entry = current.overviews.find((entry) => entry.profile.id === target.runtimeId)
        const taskId = entry?.snapshot
          ? taskInputOwner(entry.snapshot.workspace.tasks, target.taskId)
          : target.taskId
        const destination: NotificationTarget = {
          runtimeId: target.runtimeId,
          viewId: 'tasks',
          entityId: taskId,
        }
        if (sameNoticeThread(destination, current.active)) return true
        const inputId = JSON.stringify([target.inputType, target.inputId])
        const key = JSON.stringify([JSON.stringify([target.runtimeId, taskId]), 'input', inputId])
        const title =
          entry?.snapshot?.workspace.tasks.find((task) => task.id === taskId)?.title ??
          uiText('Thread')
        setNotices((pending) =>
          pending.some((notice) => notice.key === key)
            ? pending
            : [...pending, { key, title, target: destination, inputId, confirmed: false }].slice(
                -50,
              ),
        )
        return true
      }),
    [uiText],
  )
  const notice = notices[0]
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(
      () => setNotices((pending) => pending.filter((item) => item.key !== notice.key)),
      8000,
    )
    return () => clearTimeout(timer)
  }, [notice?.key])
  if (!foreground || !navigation?.key) return null
  const computer = (target: NotificationTarget) =>
    overviews.find((entry) => entry.profile.id === target.runtimeId)
  const noticeComputer = notice && computer(notice.target)
  const returnVisible = returnTo && sameNoticeThread(returnTo.destination, active) ? returnTo : null
  if ((!enabled || !notice) && !returnVisible) return null
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: insets.left + 12,
        right: insets.right + 12,
        alignItems: 'center',
        gap: 8,
        zIndex: 1000,
      }}
    >
      {enabled && notice && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            width: '100%',
            maxWidth: 560,
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: 16,
            borderWidth: highContrast ? 2 : 1,
            borderColor: colors.accent,
            backgroundColor: colors.elevated,
            boxShadow: '0 4px 16px #00000030',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Open {value0}', { value0: notice.title })}
            style={{ flex: 1, minWidth: 0, padding: 14, gap: 3 }}
            onPress={() => {
              if (active) {
                const origin = computer(active)
                setReturnTo({
                  href: taskHref(
                    active.runtimeId,
                    active.entityId,
                    params.questionId,
                    params.parentRuntimeId && params.parentTaskId
                      ? {
                          runtimeId: params.parentRuntimeId,
                          runtimeIdentity: params.parentRuntimeIdentity,
                          taskId: params.parentTaskId,
                          title: params.parentTitle ?? uiText('Thread'),
                        }
                      : undefined,
                    params.runtimeIdentity,
                    params.nativeAgentKey,
                  ),
                  destination: notice.target,
                  title:
                    origin?.snapshot?.workspace.tasks.find((task) => task.id === active.entityId)
                      ?.title ?? uiText('Thread'),
                })
              }
              router.push(taskHref(notice.target.runtimeId, notice.target.entityId))
              setNotices((pending) => pending.filter((pending) => pending.key !== notice.key))
            }}
          >
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>
              {uiText('Needs input')}
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600' }}>
              {notice.title}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
              {noticeComputer ? runtimeComputerName(noticeComputer) : ''}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Dismiss')}
            hitSlop={4}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setNotices((pending) => pending.slice(1))}
          >
            <Text style={{ color: colors.muted, fontSize: 24 }}>×</Text>
          </Pressable>
        </View>
      )}
      {returnVisible && (
        <Pressable
          accessibilityRole="button"
          style={{
            maxWidth: 360,
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 22,
            borderWidth: highContrast ? 2 : 1,
            borderColor: colors.border,
            backgroundColor: colors.elevated,
          }}
          onPress={() => {
            router.dismissTo(returnVisible.href)
            setReturnTo(null)
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.accent, fontWeight: '600' }}>
            {uiText('Return to {value0}', { value0: returnVisible.title })}
          </Text>
        </Pressable>
      )}
    </View>
  )
}
