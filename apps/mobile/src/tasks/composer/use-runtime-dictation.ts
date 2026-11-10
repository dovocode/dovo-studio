import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { File } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import type { AudioRecorder, NativeAudioModule, RecordingOptions } from 'expo-audio'
import {
  decodeResult,
  dictationLanguageSchema,
  dictationStatusSchema,
  runtimeDictationResultSchema,
  responses,
  type DictationLanguage,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useMobilePreferences } from '../../runtime/preferences/app-preferences'
import type { DictationCallbacks, DictationState } from './dictation'

type Session = {
  id: string
  taskId: string
  language: DictationLanguage
  recorder?: AudioRecorder
  cancelled: boolean
  finishing: boolean
  timer?: ReturnType<typeof setTimeout>
  setup: Promise<void>
  stopped?: Promise<void>
  cleanup?: Promise<void>
  audioMode?: boolean
  transcribeRemote: (data: string) => Promise<typeof runtimeDictationResultSchema.Type>
  cancelRemote: () => Promise<unknown>
}

export function useRuntimeDictation(taskId: string, callbacks: DictationCallbacks) {
  const { call, snapshot, connected, profile } = useRuntime()
  const preferences = useMobilePreferences()
  const runtimeId = snapshot?.runtimeId ?? profile?.connection.runtimeId
  const selected = !!runtimeId && preferences.runtimeDictationIds.includes(runtimeId)
  const scope = JSON.stringify([
    runtimeId,
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    taskId,
  ])
  const [state, setState] = useState<DictationState>({
    locale: '',
    isStarting: false,
    isRecording: false,
    isStopping: false,
    available: true,
    onDeviceAvailable: null,
    permissionDenied: false,
    error: null,
  })
  const mounted = useRef(true)
  const latest = useRef(callbacks)
  latest.current = callbacks
  const active = useRef<Session | null>(null)
  const update = (patch: Partial<DictationState>) => {
    if (mounted.current) setState((current) => ({ ...current, ...patch }))
  }
  const stopRecording = (session: Session) =>
    (session.stopped ??= (async () => {
      await session.setup
      if (session.recorder) await session.recorder.stop()
    })())
  const cleanup = (session: Session) =>
    (session.cleanup ??= (async () => {
      clearTimeout(session.timer)
      await session.setup.catch(() => {})
      try {
        await stopRecording(session)
      } catch {
        /* Failed setup or an interrupted recording has already stopped. */
      }
      try {
        if (session.recorder) {
          const uri = session.recorder.uri
          session.recorder.release()
          if (uri) {
            const file = new File(uri)
            if (file.exists) file.delete()
          }
        }
      } finally {
        if (session.audioMode) {
          const audio = await import('expo-audio')
          await audio.setAudioModeAsync({ allowsRecording: false })
        }
      }
    })())
  const settle = (session: Session) => {
    if (active.current !== session) return
    active.current = null
    update({ isStarting: false, isRecording: false, isStopping: false })
  }
  const cancel = async () => {
    const session = active.current
    if (!session) return
    session.cancelled = true
    update({ isStarting: false, isRecording: false, isStopping: true })
    try {
      await Promise.all([cleanup(session), session.cancelRemote()])
    } finally {
      settle(session)
    }
  }
  const stop = async () => {
    const session = active.current
    if (!session?.recorder || session.cancelled || session.finishing) return
    session.finishing = true
    clearTimeout(session.timer)
    update({ isRecording: false, isStopping: true })
    try {
      await stopRecording(session)
      if (session.cancelled) return
      const uri = session.recorder.uri
      if (!uri) throw new Error('The recording did not produce an audio file.')
      const file = new File(uri)
      if (file.size > 9600000)
        throw new Error('The recording is too large. Record a shorter message.')
      const data = await file.base64()
      if (session.cancelled) return
      const result = await session.transcribeRemote(data)
      if (!session.cancelled && active.current === session && mounted.current)
        latest.current.onFinish(result.text)
    } catch (cause) {
      if (!session.cancelled) update({ error: String(cause) })
    } finally {
      try {
        await cleanup(session)
      } catch (cause) {
        update({ error: `Could not clear the recording: ${String(cause)}` })
      }
      settle(session)
    }
  }
  const start = async () => {
    if (active.current) return
    const language = decodeResult(dictationLanguageSchema, preferences.dictationLanguage || 'auto')
    const session: Session = {
      id: randomUUID(),
      taskId,
      language: language.success ? language.data : 'auto',
      cancelled: false,
      finishing: false,
      setup: Promise.resolve(),
      cancelRemote: () => call('/api/dictation/cancel', { id: session.id }, responses.ok),
      transcribeRemote: (data) =>
        call(
          '/api/dictation/transcribe',
          {
            id: session.id,
            taskId: session.taskId,
            language: session.language,
            format: 'encoded',
            data,
          },
          runtimeDictationResultSchema,
        ),
    }
    active.current = session
    update({ isStarting: true, error: null, permissionDenied: false })
    session.setup = (async () => {
      if (!selected || !connected || !snapshot?.runtimeDictationSupported)
        throw new Error(
          'Reconnect to the selected speech computer. Enable runtime dictation in Speech settings.',
        )
      if (!requireOptionalNativeModule<NativeAudioModule>('ExpoAudio'))
        throw new Error('Update this phone’s Dovo build to record audio for its paired computer.')
      const audio = await import('expo-audio')
      const permission = await audio.requestRecordingPermissionsAsync()
      if (!permission.granted) {
        update({ permissionDenied: true })
        throw new Error('Allow microphone access for Dovo in system settings.')
      }
      if (session.cancelled) return
      const status = await call('/api/dictation/status', {}, dictationStatusSchema)
      if (!status.engine || !status.model)
        throw new Error('Download the speech model on the selected computer in Speech settings.')
      if (session.cancelled) return
      session.audioMode = true
      await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      if (session.cancelled) {
        await audio.setAudioModeAsync({ allowsRecording: false })
        return
      }
      const options: RecordingOptions = {
        ...audio.RecordingPresets.HIGH_QUALITY,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
        // WAV and ADTS can be decoded from a pipe without staging audio on the runtime.
        ios: {
          ...audio.RecordingPresets.HIGH_QUALITY.ios,
          extension: '.wav',
          outputFormat: audio.IOSOutputFormat.LINEARPCM,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        android: {
          ...audio.RecordingPresets.HIGH_QUALITY.android,
          extension: '.aac',
          outputFormat: 'aac_adts',
          audioEncoder: 'aac',
        },
      }
      // The imperative native constructor takes flattened platform options. The SDK hook
      // normally performs this step, but this recorder is created only after opt-in.
      session.recorder = new audio.AudioModule.AudioRecorder({
        ...options,
        ...(Platform.OS === 'ios' ? options.ios : options.android),
      })
      await session.recorder.prepareToRecordAsync()
      if (session.cancelled) return
      session.recorder.record()
      session.timer = setTimeout(() => void stop(), 299000)
      update({ isStarting: false, isRecording: true })
    })()
    try {
      await session.setup
    } catch (cause) {
      if (!session.cancelled) update({ error: String(cause) })
      try {
        await cleanup(session)
      } catch (error) {
        update({ error: `Could not clear the recording: ${String(error)}` })
      }
      settle(session)
    }
  }
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel
  useEffect(() => {
    mounted.current = true
    const cancelCurrent = () =>
      void cancelRef
        .current()
        .catch((cause: unknown) =>
          update({ error: `Could not confirm dictation stopped: ${String(cause)}` }),
        )
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'background') cancelCurrent()
    })
    return () => {
      mounted.current = false
      subscription.remove()
      cancelCurrent()
    }
  }, [scope, selected])
  return { ...state, selected, start, stop, cancel, clearError: () => update({ error: null }) }
}
