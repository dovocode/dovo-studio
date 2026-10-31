import AsyncStorage from '@react-native-async-storage/async-storage'
import { diagnosticMessage } from '@dovo/protocol'

const key = 'dovo.lastCrash'
export type CrashRecord = { at: string; message: string; fatal: boolean }
let pending: Promise<unknown> = Promise.resolve()

/** Keep the last unexpected error on this device so the next launch can show it once. Nothing
 * leaves the device: there is no reporting service, matching the no-account policy. */
function recordCrash(error: unknown, fatal: boolean) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const record: CrashRecord = {
    at: new Date().toISOString(),
    message: diagnosticMessage(message).slice(0, 600),
    fatal,
  }
  pending = pending
    .then(() => AsyncStorage.setItem(key, JSON.stringify(record)))
    .catch(() => undefined)
  return pending
}
export async function readLastCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'at' in parsed &&
      typeof parsed.at === 'string' &&
      'message' in parsed &&
      typeof parsed.message === 'string' &&
      'fatal' in parsed &&
      typeof parsed.fatal === 'boolean'
    )
      return {
        at: parsed.at,
        message: diagnosticMessage(parsed.message).slice(0, 600),
        fatal: parsed.fatal,
      }
    return null
  } catch {
    return null
  }
}
export function clearLastCrash() {
  return AsyncStorage.removeItem(key).catch(() => undefined)
}
type Tracker = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean
    onUnhandled: (id: number, error: unknown) => void
    onHandled: (id: number) => void
  }) => void
}
type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void
}
let installed = false
/** Fatal JS errors and unhandled rejections are recorded, then handed to the default handler so
 * development overlays and the native crash path behave as before. */
export function installCrashRecorder() {
  if (installed) return
  installed = true
  const globals = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: Tracker }
  const utils = globals.ErrorUtils
  const previous = utils?.getGlobalHandler?.()
  utils?.setGlobalHandler?.((error, isFatal) => {
    void recordCrash(error, isFatal === true)
    previous?.(error, isFatal)
  })
  globals.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, error) => {
      console.error('Unhandled promise rejection', error)
      void recordCrash(error, false)
    },
    onHandled: () => {},
  })
}
