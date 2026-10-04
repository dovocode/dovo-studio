import { liveTaskProps } from '@dovo/protocol'
import { useAppActive } from '../runtime/state/app-active'
import { nativeEffect } from '../runtime/state/native-effect'
import { Effect } from 'effect'
import { clientTaskScope, startPolling, runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../runtime/connection/provider'
const preferenceKey = 'dovo.live-activities.enabled'
const Context = createContext({
  enabled: true,
  supported: false,
  error: '',
  setEnabled: (_value: boolean) => {},
})
export const useLiveActivities = () => useContext(Context)
export function LiveActivityProvider({ children }: { children: ReactNode }) {
  const active = useAppActive()
  const { overviews, readRuntimeEffect, ready } = useRuntime()
  const [enabled, updateEnabled, enabledRef] = useApplicationState(true),
    [error, setError] = useApplicationState('')
  const [supported] = useApplicationState(
    () => Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoWidgets'),
  )
  // Native activity reads only need to follow visible state, not assistant text tokens.
  const activityRevision = JSON.stringify(
    (active && supported && enabled ? overviews : []).map((source) => {
      const snapshot = source.snapshot
      const tasks = snapshot?.workspace.tasks ?? []
      const running = tasks.filter((task) => task.status === 'running' && !task.archived)
      const needsInput = new Set(
        [...(snapshot?.questions ?? []), ...(snapshot?.approvals ?? [])].map((item) => item.taskId),
      )
      return [
        source.profile,
        source.connected,
        tasks.map((task) => [task.id, task.status, task.archived, task.turns?.at(-1)?.id]),
        running.map((task) =>
          liveTaskProps(
            task,
            snapshot?.runtimeHost ?? source.profile.name,
            snapshot?.workspace.repositories.find(
              (repository) => repository.id === task.repositoryId,
            )?.name ?? '',
            needsInput.has(task.id),
            running.length,
          ),
        ),
      ]
    }),
  )
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refresh = useRef<() => void>(() => {})
  const latest = useRef({
    overviews,
    readRuntimeEffect,
    ready,
  })
  latest.current = {
    overviews,
    readRuntimeEffect,
    ready,
  }
  useEffect(() => {
    // Coalesce streamed workspace updates while reacting promptly to status and input changes.
    if (!active || refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined
      refresh.current()
    }, 250)
  }, [active, activityRevision, ready, enabled])
  useEffect(() => {
    if (!supported) return
    const commands = clientTaskScope()
    let disposed = false
    const native = <A,>(run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    const program = Effect.scoped(
      Effect.gen(function* () {
        const value = yield* native(() => AsyncStorage.getItem(preferenceKey))
        if (disposed) return
        updateEnabled(value !== 'false')
        const { createActivityController } = yield* native(() => import('./controller'))
        const controller = yield* Effect.acquireRelease(
          createActivityController((message) => {
            if (!disposed) setError(message)
          }),
          (controller) => Effect.promise(() => controller.dispose()),
        )
        let retryAfter = 0
        const sync = Effect.gen(function* () {
          if (
            !latest.current.ready ||
            AppState.currentState !== 'active' ||
            Date.now() < retryAfter
          )
            return
          const value = latest.current
          yield* controller.sync(value.overviews, value.readRuntimeEffect, enabledRef.current)
        }).pipe(Effect.uninterruptible)
        const retireActivities = () =>
          void commands.run(
            sync.pipe(
              Effect.catchAll(() =>
                Effect.sync(() => {
                  if (!disposed)
                    setError('Live Activities could not be stopped. Try again when connected.')
                }),
              ),
            ),
          )
        // Keep one controller for this app session, but own no polling worker in the background.
        // This preserves registrations and avoids recreating an activity during a quick resume.
        let polling: ReturnType<typeof startPolling> | undefined
        const stopping = new Set<Promise<void>>()
        const pause = () => {
          const previous = polling
          polling = undefined
          if (!previous) return
          const stopped = previous.stop()
          stopping.add(stopped)
          void stopped.finally(() => stopping.delete(stopped))
        }
        const resume = () => {
          if (disposed || polling || !enabledRef.current || AppState.currentState !== 'active')
            return
          retryAfter = 0
          polling = startPolling(sync, {
            interval: 30_000,
            onError: () => {
              if (!disposed)
                setError(
                  'Live Activities could not update. Check iOS Live Activity permissions and your connection.',
                )
              retryAfter = Date.now() + 60_000
            },
          })
        }
        refresh.current = () => {
          if (enabledRef.current) {
            resume()
            polling?.refresh()
          } else {
            pause()
            // Retire existing activities once, then own no recurring worker while disabled.
            retireActivities()
          }
        }
        resume()
        if (!enabledRef.current) retireActivities()
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            pause()
            await Promise.all(stopping)
          }),
        )
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            AppState.addEventListener('change', (state) => {
              if (state === 'active') resume()
              else pause()
            }),
          ),
          (subscription) => Effect.sync(() => subscription.remove()),
        )
        yield* Effect.never
      }),
    ).pipe(
      Effect.catchAll(() =>
        Effect.sync(() => {
          if (!disposed)
            setError('Could not initialize Live Activities. Reopen the app to try again.')
        }),
      ),
    )
    void commands.run(program)
    return () => {
      disposed = true
      clearTimeout(refreshTimer.current)
      refreshTimer.current = undefined
      refresh.current = () => {}
      void commands.stop()
    }
  }, [supported])
  const setEnabled = (value: boolean) => {
    updateEnabled(value)
    setError('')
    void runClientEffect(
      nativeEffect(() => AsyncStorage.setItem(preferenceKey, String(value))).pipe(
        Effect.catchAll(() =>
          nativeEffect(() => setError('Could not save Live Activity preferences.')),
        ),
      ),
    )
  }
  return (
    <Context.Provider
      value={{
        enabled,
        supported,
        error,
        setEnabled,
      }}
    >
      {children}
    </Context.Provider>
  )
}
