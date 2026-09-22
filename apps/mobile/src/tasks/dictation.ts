import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
  ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition'

export type DictationCallbacks = {
  onResult: (text: string) => void
  onFinish: (text: string) => void
  onError?: (message: string) => void
}
export type DictationState = {
  locale: string
  isRecording: boolean
  isStarting: boolean
  isStopping: boolean
  available: boolean
  onDeviceAvailable: boolean | null
  permissionDenied: boolean
  error: string | null
}
export type DictationEvents = {
  start: () => void
  result: (event: ExpoSpeechRecognitionResultEvent) => void
  error: (event: ExpoSpeechRecognitionErrorEvent) => void
  audioend: () => void
  end: () => void
}
export type DictationDriver = {
  available: () => boolean
  supportsOnDevice: () => boolean
  inactive: () => Promise<boolean>
  locales: () => Promise<{ locales: string[]; installedLocales: string[] | null }>
  permissions: (onDevice: boolean) => Promise<{ granted: boolean; restricted?: boolean }>
  listen: (events: DictationEvents) => () => void
  start: (options: ExpoSpeechRecognitionOptions) => void
  stop: () => void
  abort: () => void
}
type Session = {
  callbacks: DictationCallbacks
  final: string[]
  interim: string
  text: string
  canceled: boolean
  nativeStarted: boolean
  remove?: () => void
}
// The native recognizer is shared. Wait for its end event before accepting another owner.
const owners = new WeakMap<DictationDriver, Session>()
const normalizeLocale = (value: string) => value.replaceAll('_', '-').toLowerCase()

/** Speech services accept language tags, not date/calendar formatting extensions. */
export function resolveDictationLocale(preferred: readonly string[], supported: readonly string[]) {
  const canonical = (value: string) => {
    try {
      // Hermes implements getCanonicalLocales; Intl.Locale is not available in every build.
      return Intl.getCanonicalLocales(value.replaceAll('_', '-'))[0]?.split(/-[a-z0-9]-/i)[0]
    } catch {
      return undefined // Ignore malformed tags from a platform's language catalog.
    }
  }
  const available = supported.flatMap((tag) => {
    const locale = canonical(tag)
    return locale ? [locale] : []
  })
  const preferences = preferred.flatMap((tag) => {
    const locale = canonical(tag)
    return locale ? [locale] : []
  })
  for (const preference of preferences) {
    const exact = available.find((locale) => locale === preference)
    if (exact) return exact
    const [language, script] = preference.split('-')
    const sameLanguage = available.filter((locale) => {
      const parts = locale.split('-')
      return parts[0] === language && (!script || script.length !== 4 || parts[1] === script)
    })
    // Prefer another explicit choice for this language before the service's regional variants.
    const fallback = preferences.find((locale) => sameLanguage.includes(locale)) ?? sameLanguage[0]
    if (fallback) return fallback
  }
  // An unavailable catalog must not block a service that can still recognize online.
  return preferences[0] ?? 'en-US'
}

export function dictationError(event: ExpoSpeechRecognitionErrorEvent): string {
  switch (event.error) {
    case 'not-allowed':
      return 'Allow microphone and speech recognition for Dovo Studio in Settings.'
    case 'audio-capture':
      return 'The microphone is unavailable. Check microphone access and try again.'
    case 'network':
      return 'Speech recognition needs a connection for this language. Reconnect or install its on-device speech model in system settings.'
    case 'language-not-supported':
      return 'Speech recognition does not support your current device language. Check your system language and speech settings.'
    case 'service-not-allowed':
      return 'Speech recognition is unavailable. Enable dictation or a speech recognition service in system settings.'
    case 'busy':
      return 'The speech recognizer is busy. Finish the current dictation and try again.'
    case 'no-speech':
    case 'speech-timeout':
      return 'No speech was detected. Try speaking closer to the microphone.'
    case 'interrupted':
      return 'Dictation was interrupted. Your recognized text has been kept.'
    case 'aborted':
      return 'Dictation stopped. Your recognized text has been kept.'
    default:
      return event.message || 'Dictation could not finish. Try again.'
  }
}

/** Owns one native dictation session; UI lifetime and callback changes cannot retarget it. */
export function createDictation(
  driver: DictationDriver | null,
  preferredLocales: () => readonly string[],
  continuous: boolean,
) {
  let state: DictationState = {
    locale: resolveDictationLocale(preferredLocales(), []),
    isRecording: false,
    isStarting: false,
    isStopping: false,
    available: false,
    onDeviceAvailable: null,
    permissionDenied: false,
    error: null,
  }
  let current: Session | null = null
  let disposed = false
  const subscribers = new Set<() => void>()
  const update = (patch: Partial<DictationState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    subscribers.forEach((notify) => notify())
  }
  const fail = (message: string, session?: Session, permissionDenied = false) => {
    update({ error: message, permissionDenied })
    if (!disposed && session && !session.canceled) session.callbacks.onError?.(message)
  }
  const finish = (session: Session) => {
    if (current !== session) return
    current = null
    session.remove?.()
    if (driver && owners.get(driver) === session) owners.delete(driver)
    update({ isRecording: false, isStarting: false, isStopping: false })
    if (!disposed && !session.canceled && session.nativeStarted)
      session.callbacks.onFinish(session.text)
  }
  const inspect = async () => {
    if (!driver) return
    try {
      const available = driver.available()
      const supported = driver.supportsOnDevice()
      update({ available, onDeviceAvailable: supported ? null : false })
      // Language support is advisory; a service that cannot report it can still recognize online.
      // Some Android recognition services don't answer capability queries. Don't let
      // optional offline-language discovery block recording indefinitely.
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        driver.locales().catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 3000)
        }),
      ]).finally(() => clearTimeout(timer))
      const locale = resolveDictationLocale(preferredLocales(), result?.locales ?? [])
      const onDevice = !supported
        ? false
        : result?.installedLocales
          ? result.installedLocales.some(
              (item) => normalizeLocale(item) === normalizeLocale(locale),
            )
          : null
      update({ locale, onDeviceAvailable: onDevice, available: available || onDevice === true })
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : 'Speech recognition is unavailable on this device.',
      )
    }
  }
  const cancel = () => {
    const session = current
    if (!session || !driver) return
    session.canceled = true
    update({ isRecording: false, isStarting: false, isStopping: true })
    if (session.nativeStarted) {
      try {
        driver.abort()
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not stop dictation.')
        finish(session)
      }
    } else finish(session)
  }
  const stop = () => {
    const session = current
    if (!session || !driver) return
    if (!session.nativeStarted) {
      cancel()
      return
    }
    if (state.isStopping) return
    update({ isRecording: false, isStarting: false, isStopping: true })
    try {
      driver.stop()
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not finish dictation.', session)
      try {
        driver.abort()
      } catch {
        finish(session)
      }
    }
  }
  const start = async (callbacks: DictationCallbacks) => {
    if (disposed || current) return
    if (!driver) {
      fail(
        'Dictation requires the native Dovo app with speech recognition support. Install the latest app build.',
      )
      return
    }
    if (owners.has(driver)) {
      fail('Another dictation is still finishing. Try again in a moment.')
      return
    }
    const session: Session = {
      callbacks,
      final: [],
      interim: '',
      text: '',
      canceled: false,
      nativeStarted: false,
    }
    current = session
    owners.set(driver, session)
    update({ isStarting: true, error: null, permissionDenied: false })
    try {
      await inspect()
      if (session.canceled || disposed) {
        finish(session)
        return
      }
      if (!state.available)
        throw new Error(
          'Speech recognition is unavailable. Enable dictation or a speech recognition service in system settings.',
        )
      const permission = await driver.permissions(state.onDeviceAvailable === true)
      if (session.canceled || disposed) {
        finish(session)
        return
      }
      if (!permission.granted) {
        fail(
          permission.restricted
            ? 'Speech recognition is restricted by your device settings.'
            : 'Allow microphone and speech recognition for Dovo Studio in Settings.',
          session,
          true,
        )
        finish(session)
        return
      }
      session.remove = driver.listen({
        start: () => {
          if (current === session && !session.canceled)
            update({ isStarting: false, isRecording: true })
        },
        result: (event) => {
          if (disposed || current !== session || session.canceled) return
          const text = event.results[0]?.transcript.trim()
          if (!text) return // iOS can emit an empty final after the final speech segment.
          if (event.isFinal) {
            session.final.push(text)
            session.interim = ''
          } else session.interim = text
          session.text = [...session.final, session.interim].filter(Boolean).join(' ')
          session.callbacks.onResult(session.text)
        },
        error: (event) => {
          if (current !== session || session.canceled) return
          fail(dictationError(event), session, event.error === 'not-allowed')
          // iOS can fail while constructing its recognizer and emit error without end.
          // Release ownership only once native teardown is confirmed, never on error alone.
          void driver.inactive().then(
            (inactive) => {
              if (inactive) finish(session)
            },
            (error: unknown) => {
              if (current !== session || session.canceled) return
              fail(
                `${dictationError(event)} Could not check whether dictation stopped: ${error instanceof Error ? error.message : 'native speech service unavailable'}`,
                session,
                event.error === 'not-allowed',
              )
            },
          )
        },
        audioend: () => {
          if (current === session)
            update({ isRecording: false, isStarting: false, isStopping: true })
        },
        end: () => finish(session),
      })
      session.nativeStarted = true
      driver.start({
        lang: state.locale,
        interimResults: true,
        continuous,
        maxAlternatives: 1,
        addsPunctuation: true,
        requiresOnDeviceRecognition: state.onDeviceAvailable === true,
        recordingOptions: { persist: false },
        iosTaskHint: 'dictation',
      })
    } catch (error) {
      if (!session.canceled && current === session)
        fail(error instanceof Error ? error.message : 'Could not start dictation.', session)
      finish(session)
    }
  }
  return {
    activate: () => {
      // React StrictMode replays effect setup/cleanup with the same controller instance.
      disposed = false
      update({ isStarting: false, isRecording: false, isStopping: !!current })
    },
    inspect,
    start,
    stop,
    cancel,
    clearError: () => update({ error: null, permissionDenied: false }),
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      subscribers.add(notify)
      return () => {
        subscribers.delete(notify)
      }
    },
    dispose: () => {
      disposed = true
      subscribers.clear()
      cancel()
    },
  }
}
