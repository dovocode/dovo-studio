import { nativeEffect } from '../runtime/native-effect'
import { Effect } from 'effect'
import { clientTaskScope, startPolling, runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../runtime/provider'
const preferenceKey = 'dovo.live-activities.enabled'
const Context = createContext({
  enabled: true,
  supported: false,
  error: '',
  setEnabled: (_value: boolean) => {},
})
export const useLiveActivities = () => useContext(Context)
export function LiveActivityProvider({ children }: { children: ReactNode }) {
  const { overviews, readRuntimeEffect, ready } = useRuntime()
  const [enabled, updateEnabled, enabledRef] = useApplicationState(true),
    [error, setError] = useApplicationState('')
  const [supported] = useApplicationState(
    () => Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoWidgets'),
  )
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
        const polling = startPolling(sync, {
          interval: 3000,
          onError: () => {
            if (!disposed)
              setError(
                'Live Activities could not update. Check iOS Live Activity permissions and your connection.',
              )
            retryAfter = Date.now() + 60_000
          },
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => polling.stop()))
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            AppState.addEventListener('change', (state) => {
              if (state === 'active') polling.refresh()
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
