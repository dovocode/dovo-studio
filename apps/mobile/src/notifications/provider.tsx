import { useMobileAccount } from '../runtime/connection/account-provider'
import { runtimeComputerName } from '@dovo/protocol'
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
const serverPreferenceKey = 'dovo.push-notifications.disabled-servers'
const Context = createContext({
  enabled: false,
  supported: false,
  busy: false,
  error: '',
  setEnabled: (_enabled: boolean) => {},
  serverEnabled: (_id: string): boolean => true,
  setServerEnabled: (_id: string, _enabled: boolean) => {},
})
export const usePushNotifications = () => useContext(Context)
export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime()
  const account = useMobileAccount()
  const accountRef = useRef(account)
  accountRef.current = account
  const [disabledServers, setDisabledServers, disabledServersRef] = useApplicationState<string[]>(
    [],
  )
  const setServer = useRef<(id: string, value: boolean) => Promise<void>>(async () => {})
  const deferredTarget = useRef<NotificationTarget | null>(null)
  useEffect(() => {
    const target = deferredTarget.current
    if (!target || !runtime.ready) return
    deferredTarget.current = null
    router.push(notificationHref(target))
  }, [runtime.ready])
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
  const refreshRegistration = useRef<() => void>(() => {})
  const hosts = JSON.stringify(
    runtime.overviews.map((entry) => [entry.profile.id, entry.profile.connection, entry.connected]),
  )
  useEffect(
    () => refreshRegistration.current(),
    [hosts, runtime.ready, account.directory?.user.id, disabledServers],
  )
  const toggle = useRef<(value: boolean) => Promise<void>>(async () => {})
  useEffect(() => {
    if (!supported) return
    let disposed = false
    let syncPending: Promise<void> | undefined
    let syncAgain = false
    let nativeToken: string | undefined
    let managed = false
    let toggling = false
    const registered = new Map<string, { key: string; at: number }>()
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
      subscriptions.push({ remove: () => Notifications.setNotificationHandler(null) })
      const open = (data: unknown) => {
        const target = notificationTarget(data)
        if (!target) return
        if (!latest.current.ready) {
          deferredTarget.current = target
          return
        }
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
      if (disposed) return
      if (response) handleResponse(response)
      const sync = () => {
        if (syncPending) {
          syncAgain = true
          return syncPending
        }
        syncPending = (async () => {
          if (
            disposed ||
            !latest.current.ready ||
            AppState.currentState !== 'active' ||
            (!enabledRef.current && !managed)
          )
            return
          const errors: string[] = []
          const permission = enabledRef.current
            ? await Notifications.getPermissionsAsync()
            : undefined
          const permitted = permission?.granted !== false
          if (!permitted) errors.push('Notifications are disabled in system settings.')
          if (enabledRef.current && permitted && !nativeToken) {
            if (Platform.OS === 'android')
              await Notifications.setNotificationChannelAsync('dovo-tasks', {
                name: 'Dovo tasks',
                importance: Notifications.AndroidImportance.HIGH,
              })
            const result = await Notifications.getDevicePushTokenAsync()
            if (typeof result.data !== 'string')
              throw new Error('Native push tokens are unavailable on this device')
            nativeToken = result.data
          }
          const enabled = enabledRef.current && permitted
          if (accountRef.current.directory) {
            try {
              await accountRef.current.client.retainPush(
                enabled
                  ? latest.current.overviews
                      .filter((entry) => !disabledServersRef.current.includes(entry.profile.id))
                      .map((entry) => entry.profile.id)
                  : [],
              )
            } catch {
              errors.push(
                'Could not revoke disabled server notifications on Connect. Try again when connected.',
              )
            }
          }
          const token = nativeToken
          for (const entry of latest.current.overviews) {
            const serverEnabled = enabled && !disabledServersRef.current.includes(entry.profile.id)
            if (!entry.connected || disposed) continue
            const key = JSON.stringify([
              entry.profile.id,
              entry.profile.connection.address,
              entry.profile.connection.token,
              serverEnabled,
              accountRef.current.directory?.user.id,
              token,
            ])
            const previous = registered.get(entry.profile.id)
            if (previous?.key === key && Date.now() - previous.at < 300_000) continue
            try {
              if (serverEnabled && token) {
                const registration = {
                  runtimeId: entry.profile.id,
                  platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
                  token,
                  environment:
                    Constants.expoConfig?.extra?.pushEnvironment === 'production'
                      ? ('production' as const)
                      : ('sandbox' as const),
                }
                const grant = accountRef.current.directory
                  ? await accountRef.current.client.subscribePush(registration)
                  : undefined
                if (disposed || syncAgain) continue
                const status = await latest.current.readRuntime(
                  entry.profile,
                  '/api/notifications/register',
                  { ...registration, ...(grant ? { managedToken: grant.token } : {}) },
                  pushStatusSchema,
                )
                if (!status.configured || !status.registered || status.error) {
                  errors.push(
                    `${runtimeComputerName(entry)}: ${status.error ?? 'Push registration is not ready.'}`,
                  )
                  continue
                }
              } else
                await latest.current.readRuntime(
                  entry.profile,
                  '/api/notifications/remove',
                  {},
                  responses.ok,
                )
              registered.set(entry.profile.id, { key, at: Date.now() })
            } catch {
              errors.push(
                `${runtimeComputerName(entry)}: could not enable notifications. Check Connect delivery and update this runtime, or configure its standalone relay.`,
              )
            }
          }
          if (!disposed && !syncAgain) setError(errors.join('\n'))
        })().finally(async () => {
          syncPending = undefined
          if (syncAgain && !disposed) {
            syncAgain = false
            await sync()
          }
        })
        return syncPending
      }
      toggle.current = async (value) => {
        if (disposed || toggling) return
        toggling = true
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
            if (disposed) return
            if (!permissions.granted)
              throw new Error('Allow notifications in system settings first')
          }
          await AsyncStorage.setItem(preferenceKey, String(value))
          if (disposed) return
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
          toggling = false
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
      setServer.current = async (id, value) => {
        if (disposed || toggling) return
        toggling = true
        setBusy(true)
        setError('')
        try {
          const next = value
            ? disabledServersRef.current.filter((server) => server !== id)
            : [...new Set([...disabledServersRef.current, id])]
          await AsyncStorage.setItem(serverPreferenceKey, JSON.stringify(next))
          if (disposed) return
          setDisabledServers(next)
          registered.delete(id)
          await sync()
        } catch {
          if (!disposed) setError('Could not update server notifications. Try again.')
        } finally {
          toggling = false
          if (!disposed) setBusy(false)
        }
      }
      const storedServers = await AsyncStorage.getItem(serverPreferenceKey)
      const parsed: unknown = storedServers ? JSON.parse(storedServers) : []
      if (!Array.isArray(parsed) || !parsed.every((id): id is string => typeof id === 'string'))
        throw new Error('Invalid notification preferences')
      if (disposed) return
      setDisabledServers(parsed)
      const saved = await AsyncStorage.getItem(preferenceKey)
      if (disposed) return
      managed = saved !== null
      updateEnabled(saved === 'true')
      const refresh = () => {
        void sync().catch(() => {
          if (!disposed) setError('Could not register push notifications. Check your connection.')
        })
      }
      refreshRegistration.current = refresh
      let interval: ReturnType<typeof setInterval> | undefined
      const schedule = () => {
        clearInterval(interval)
        interval = AppState.currentState === 'active' ? setInterval(refresh, 5 * 60_000) : undefined
      }
      schedule()
      subscriptions.push({ remove: () => clearInterval(interval) })
      subscriptions.push(
        AppState.addEventListener('change', (state) => {
          schedule()
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
      setServer.current = async () => {}
      refreshRegistration.current = () => {}
    }
  }, [supported])
  return (
    <Context.Provider
      value={{
        enabled,
        supported,
        busy,
        error,
        serverEnabled: (id) => !disabledServers.includes(id),
        setServerEnabled: (id, value) => {
          void setServer.current(id, value)
        },
        setEnabled: (value) => {
          void toggle.current(value)
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}
