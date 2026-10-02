import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import type { NotificationResponse } from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { pushStatusSchema, responses } from '@dovo/protocol'
import { notificationTarget, notificationHref, type NotificationTarget } from './target'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'

const preferenceKey = 'dovo.push-notifications.enabled'
const Context = createContext({
  enabled: false,
  supported: false,
  busy: false,
  error: '',
  setEnabled: (_enabled: boolean) => {},
})
export const usePushNotifications = () => useContext(Context)
export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime()
  const deferredTarget = useRef<NotificationTarget | null>(null)
  useEffect(() => {
    const target = deferredTarget.current
    if (!target || !runtime.ready) return
    deferredTarget.current = null
    if (runtime.profiles.some((profile) => profile.id === target.runtimeId))
      router.push(notificationHref(target))
  }, [runtime.ready, runtime.profiles])
  const latest = useRef(runtime)
  latest.current = runtime
  const [enabled, updateEnabled, enabledRef] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const [supported] = useApplicationState(
    () =>
      (Platform.OS === 'ios' || Platform.OS === 'android') &&
      !!requireOptionalNativeModule('ExpoPushTokenManager'),
  )
  const toggle = useRef<(value: boolean) => Promise<void>>(async () => {})
  useEffect(() => {
    if (!supported) return
    let disposed = false
    let syncPending: Promise<void> | undefined
    let nativeToken: string | undefined
    let managed = false
    const registered = new Map<string, number>()
    const subscriptions: Array<{ remove: () => void }> = []
    const initialize = async () => {
      const Notifications = await import('expo-notifications')
      if (disposed) return
      await Notifications.setNotificationCategoryAsync('dovo-question', [
        {
          identifier: 'answer-question',
          buttonTitle: 'Answer question',
          options: { opensAppToForeground: true },
        },
      ])
      if (disposed) return
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => ({
          shouldPlaySound: notification.request.content.data?.kind === 'input',
          shouldSetBadge: false,
          shouldShowBanner: notification.request.content.data?.kind === 'input',
          shouldShowList: true,
        }),
      })
      const open = (data: unknown) => {
        const target = notificationTarget(data)
        if (!target) return
        if (!latest.current.ready) {
          deferredTarget.current = target
          return
        }
        if (!latest.current.profiles.some((profile) => profile.id === target.runtimeId)) return
        router.push(notificationHref(target))
      }
      let lastOpened: string | undefined
      const handleResponse = (response: NotificationResponse) => {
        if (disposed || lastOpened === response.notification.request.identifier) return
        lastOpened = response.notification.request.identifier
        open(response.notification.request.content.data)
        void Notifications.clearLastNotificationResponseAsync().catch(() => {
          if (!disposed) setError('Could not clear the opened notification')
        })
      }
      subscriptions.push(Notifications.addNotificationResponseReceivedListener(handleResponse))
      const response = await Notifications.getLastNotificationResponseAsync()
      if (response) handleResponse(response)
      const sync = () => {
        if (syncPending) return syncPending
        syncPending = (async () => {
          if (
            disposed ||
            !latest.current.ready ||
            AppState.currentState !== 'active' ||
            (!enabledRef.current && !managed)
          )
            return
          if (enabledRef.current && !nativeToken) {
            if (Platform.OS === 'android')
              await Notifications.setNotificationChannelAsync('dovo-tasks', {
                name: 'Dovo tasks',
                importance: Notifications.AndroidImportance.HIGH,
              })
            const permission = await Notifications.getPermissionsAsync()
            if (!permission.granted) {
              if (!disposed) setError('Notifications are disabled in system settings.')
              return
            }
            const result = await Notifications.getDevicePushTokenAsync()
            if (typeof result.data !== 'string')
              throw new Error('Native push tokens are unavailable on this device')
            nativeToken = result.data
          }
          for (const entry of latest.current.overviews) {
            if (!entry.connected || disposed) continue
            const key = `${entry.profile.id}:${enabledRef.current}:${nativeToken ?? ''}`
            if (Date.now() - (registered.get(key) ?? 0) < 300_000) continue
            try {
              if (enabledRef.current && nativeToken) {
                const status = await latest.current.readRuntime(
                  entry.profile,
                  '/api/notifications/register',
                  {
                    runtimeId: entry.profile.id,
                    platform: Platform.OS,
                    token: nativeToken,
                    environment:
                      Constants.expoConfig?.extra?.pushEnvironment === 'production'
                        ? 'production'
                        : 'sandbox',
                  },
                  pushStatusSchema,
                )
                if (status.error && !disposed) setError(`${entry.profile.name}: ${status.error}`)
              } else
                await latest.current.readRuntime(
                  entry.profile,
                  '/api/notifications/remove',
                  {},
                  responses.ok,
                )
              registered.set(key, Date.now())
            } catch {
              if (!disposed)
                setError(
                  `${entry.profile.name}: configure the push relay and update this runtime to enable notifications.`,
                )
            }
          }
        })().finally(() => {
          syncPending = undefined
        })
        return syncPending
      }
      toggle.current = async (value) => {
        if (disposed) return
        setBusy(true)
        setError('')
        try {
          if (value) {
            if (Platform.OS === 'android')
              await Notifications.setNotificationChannelAsync('dovo-tasks', {
                name: 'Dovo tasks',
                importance: Notifications.AndroidImportance.HIGH,
              })
            const permissions = await Notifications.requestPermissionsAsync()
            if (!permissions.granted)
              throw new Error('Allow notifications in system settings first')
          }
          await AsyncStorage.setItem(preferenceKey, String(value))
          managed = true
          updateEnabled(value)
          registered.clear()
          await sync()
        } catch (error) {
          if (!disposed)
            setError(
              error instanceof Error ? error.message : 'Could not configure push notifications',
            )
        } finally {
          if (!disposed) setBusy(false)
        }
      }
      subscriptions.push(
        Notifications.addPushTokenListener((token) => {
          if (typeof token.data === 'string') {
            nativeToken = token.data
            registered.clear()
            void sync().catch(() => {
              if (!disposed) setError('Could not update the push token')
            })
          }
        }),
      )
      const saved = await AsyncStorage.getItem(preferenceKey)
      if (disposed) return
      managed = saved !== null
      updateEnabled(saved === 'true')
      const refresh = () => {
        void sync().catch(() => {
          if (!disposed) setError('Could not register push notifications. Check your connection.')
        })
      }
      const interval = setInterval(refresh, 15_000)
      subscriptions.push({ remove: () => clearInterval(interval) })
      subscriptions.push(
        AppState.addEventListener('change', (state) => {
          if (state === 'active') {
            registered.clear()
            refresh()
          }
        }),
      )
      refresh()
    }
    void initialize().catch(() => {
      if (!disposed)
        setError('Push notifications need a new native app build and valid platform credentials')
    })
    return () => {
      disposed = true
      subscriptions.forEach((subscription) => subscription.remove())
      toggle.current = async () => {}
    }
  }, [supported])
  return (
    <Context.Provider
      value={{
        enabled,
        supported,
        busy,
        error,
        setEnabled: (value) => {
          void toggle.current(value)
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}
