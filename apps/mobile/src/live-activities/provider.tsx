import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../runtime/provider'
import type { createActivityController } from './controller'
const preferenceKey = 'dovo.live-activities.enabled'
const Context = createContext({
  enabled: true,
  supported: false,
  error: '',
  setEnabled: (_value: boolean) => {},
})
export const useLiveActivities = () => useContext(Context)
export function LiveActivityProvider({ children }: { children: ReactNode }) {
  const { overviews, readRuntime, ready } = useRuntime()
  const [enabled, updateEnabled] = useState(true),
    [error, setError] = useState('')
  const [supported] = useState(
    () => Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoWidgets'),
  )
  const latest = useRef({ overviews, readRuntime, enabled, ready })
  latest.current = { overviews, readRuntime, enabled, ready }
  const controller = useRef<Awaited<ReturnType<typeof createActivityController>> | null>(null)
  useEffect(() => {
    if (!supported) return
    let stopped = false,
      busy = false,
      retryAfter = 0
    const sync = async () => {
      if (
        !controller.current ||
        !latest.current.ready ||
        busy ||
        stopped ||
        AppState.currentState !== 'active' ||
        Date.now() < retryAfter
      )
        return
      busy = true
      try {
        const value = latest.current
        await controller.current.sync(value.overviews, value.readRuntime, value.enabled)
      } catch {
        setError(
          'Live Activities could not update. Check iOS Live Activity permissions and your connection.',
        )
        retryAfter = Date.now() + 60_000
      } finally {
        busy = false
      }
    }
    void AsyncStorage.getItem(preferenceKey)
      .then(async (value) => {
        if (stopped) return
        latest.current.enabled = value !== 'false'
        updateEnabled(value !== 'false')
        const { createActivityController } = await import('./controller')
        const next = await createActivityController(setError)
        if (stopped) next.dispose()
        else {
          controller.current = next
          void sync()
        }
      })
      .catch(() => setError('Could not initialize Live Activities. Reopen the app to try again.'))
    const timer = setInterval(() => void sync(), 3000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync()
    })
    return () => {
      stopped = true
      clearInterval(timer)
      subscription.remove()
      controller.current?.dispose()
      controller.current = null
    }
  }, [supported])
  const setEnabled = (value: boolean) => {
    updateEnabled(value)
    setError('')
    void AsyncStorage.setItem(preferenceKey, String(value)).catch(() =>
      setError('Could not save Live Activity preferences.'),
    )
  }
  return (
    <Context.Provider value={{ enabled, supported, error, setEnabled }}>
      {children}
    </Context.Provider>
  )
}
