import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BROWSER_STORAGE_KEY,
  initialBrowserState,
  parseBrowserState,
  persistableBrowserState,
  type BrowserState,
} from './browser-state'

function useBrowserStore() {
  const [state, setState] = useState(() => initialBrowserState(randomUUID()))
  const current = useRef(state)
  const [loaded, setLoaded] = useState(false)
  const [writable, setWritable] = useState(false)
  const [storageError, setStorageError] = useState('')
  const saves = useRef(Promise.resolve())
  const change = useCallback((update: (previous: BrowserState) => BrowserState) => {
    const next = update(current.current)
    if (next === current.current) return
    current.current = next
    setState(next)
  }, [])
  useEffect(() => {
    let alive = true
    void AsyncStorage.getItem(BROWSER_STORAGE_KEY).then(
      (raw) => {
        if (!alive) return
        try {
          if (raw) change(() => parseBrowserState(raw))
          setWritable(true)
        } catch {
          setStorageError(
            'Saved browser data could not be restored. Reset saved browser data to save new tabs.',
          )
        }
        setLoaded(true)
      },
      (cause: unknown) => {
        if (!alive) return
        setStorageError(`Could not load browser data: ${String(cause)}`)
        setLoaded(true)
      },
    )
    return () => {
      alive = false
    }
  }, [change])
  useEffect(() => {
    if (!loaded || !writable) return
    const raw = JSON.stringify(persistableBrowserState(state, randomUUID()))
    saves.current = saves.current
      .then(() => AsyncStorage.setItem(BROWSER_STORAGE_KEY, raw))
      .catch((cause: unknown) =>
        setStorageError(`Browser data could not be saved: ${String(cause)}`),
      )
  }, [state, loaded, writable])
  const resetStorage = async () => {
    await saves.current
    await AsyncStorage.removeItem(BROWSER_STORAGE_KEY)
    setStorageError('')
    setWritable(true)
  }
  return { state, current, loaded, writable, storageError, change, resetStorage }
}
const Context = createContext<ReturnType<typeof useBrowserStore> | null>(null)
/** Browser and Unified operate on the same tabs and ordered persistence queue. */
export function BrowserWorkspaceProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useBrowserStore()}>{children}</Context.Provider>
}
export function useBrowserWorkspace() {
  const store = useContext(Context)
  if (!store) throw new Error('BrowserWorkspaceProvider required')
  return store
}
