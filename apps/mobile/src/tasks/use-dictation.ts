import { requireOptionalNativeModule } from 'expo'
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import type { Locale } from 'expo-localization'
import { AppState, Platform } from 'react-native'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createDictation, type DictationCallbacks, type DictationDriver } from './dictation'

// Optional loading keeps old native builds and web usable until the native module is installed.
const native =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>('ExpoSpeechRecognition')
    : null
const localization =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<{ getLocales: () => Locale[] }>('ExpoLocalization')
    : null
const preferredLocales = () =>
  localization?.getLocales().map((locale) => locale.languageTag) ?? [
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]
const driver: DictationDriver | null = native
  ? {
      available: () => native.isRecognitionAvailable(),
      supportsOnDevice: () => native.supportsOnDeviceRecognition(),
      inactive: async () => (await native.getStateAsync()) === 'inactive',
      locales: async () => {
        const result = await native.getSupportedLocales({})
        // iOS reports every supported language as "installed", even without a downloaded model.
        // Let Apple's recognizer choose its available path instead of forcing an unavailable model.
        return {
          ...result,
          installedLocales: Platform.OS === 'ios' ? null : result.installedLocales,
        }
      },
      permissions: () => native.requestPermissionsAsync(),
      start: (options) => native.start(options),
      stop: () => native.stop(),
      abort: () => native.abort(),
      listen: (events) => {
        const subscriptions = [
          native.addListener('start', events.start),
          native.addListener('result', events.result),
          native.addListener('error', events.error),
          native.addListener('audioend', events.audioend),
          native.addListener('end', events.end),
        ]
        return () => subscriptions.forEach((subscription) => subscription.remove())
      },
    }
  : null

export function useDictation(callbacks: DictationCallbacks) {
  const [dictation] = useState(() =>
    createDictation(
      driver,
      preferredLocales,
      Platform.OS === 'ios' || Number(Platform.Version) >= 33,
    ),
  )
  const currentCallbacks = useRef(callbacks)
  currentCallbacks.current = callbacks
  const state = useSyncExternalStore(
    dictation.subscribe,
    dictation.getSnapshot,
    dictation.getSnapshot,
  )
  useEffect(() => {
    dictation.activate()
    void dictation.inspect()
    const subscription = AppState.addEventListener('change', (state) => {
      // Permission dialogs may temporarily make iOS inactive. Only backgrounding ends capture.
      if (state === 'background') dictation.stop()
    })
    return () => {
      subscription.remove()
      dictation.dispose()
    }
  }, [dictation])
  const start = useCallback(() => dictation.start(currentCallbacks.current), [dictation])
  return {
    ...state,
    start,
    stop: dictation.stop,
    cancel: dictation.cancel,
    clearError: dictation.clearError,
  }
}
