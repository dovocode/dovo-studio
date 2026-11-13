import * as Speech from 'expo-speech'
import { botCallSpeech, type BotCallAudio } from '@dovo/client-runtime'
import { createMobileDictation } from '../tasks/composer/use-dictation'

// The platform microphone and speech session are shared across call screens.
let stoppingAudio: Promise<Error | undefined> = Promise.resolve(undefined)
function microphoneStopped(dictation: ReturnType<typeof createMobileDictation>) {
  const idle = () => {
    const state = dictation.getSnapshot()
    return !state.isRecording && !state.isStarting && !state.isStopping
  }
  if (idle()) return Promise.resolve(undefined)
  return new Promise<Error | undefined>((resolve) => {
    let unsubscribe = () => {}
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      unsubscribe()
      resolve(error)
    }
    const timeout = setTimeout(
      () => finish(new Error('The microphone is still stopping. Try again.')),
      3000,
    )
    unsubscribe = dictation.subscribe(() => {
      if (idle()) finish()
    })
    if (idle()) finish()
  })
}
export function mobileBotCallAudio(): BotCallAudio {
  const dictation = createMobileDictation()
  return {
    async listen(signal, events) {
      signal.throwIfAborted()
      const stopping = await stoppingAudio
      signal.throwIfAborted()
      if (stopping) {
        stoppingAudio = Promise.resolve(undefined)
        throw stopping
      }
      dictation.activate()
      let silence: ReturnType<typeof setTimeout> | undefined
      const stop = () => {
        clearTimeout(silence)
        dictation.cancel()
        stoppingAudio = microphoneStopped(dictation)
      }
      signal.addEventListener('abort', stop, { once: true })
      await dictation.start({
        onResult: (text) => {
          if (signal.aborted) return
          events.preview(text)
          clearTimeout(silence)
          silence = setTimeout(() => dictation.stop(), 1100)
        },
        onFinish: (text) => {
          clearTimeout(silence)
          signal.removeEventListener('abort', stop)
          if (!signal.aborted) events.finish(text)
        },
        onError: (message) => {
          clearTimeout(silence)
          if (!signal.aborted) events.error(new Error(message))
        },
      })
      if (signal.aborted) {
        stop()
        return
      }
      const state = dictation.getSnapshot()
      if (state.error) {
        signal.removeEventListener('abort', stop)
        throw Error(state.error)
      }
    },
    async speak(text, signal) {
      signal.throwIfAborted()
      const value = botCallSpeech(text)
      if (!value) return
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          stoppingAudio = Speech.stop().then(
            () => undefined,
            (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
          )
          void stoppingAudio.then((error) => done(error))
        }
        const done = (error?: Error) => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', stop)
          if (error) reject(error)
          else resolve()
        }
        const timeout = setTimeout(() => {
          void Speech.stop().then(
            () => done(new Error('Speech playback timed out. Read the reply in chat.')),
            (error: unknown) => done(error instanceof Error ? error : new Error(String(error))),
          )
        }, 180000)
        signal.addEventListener('abort', stop, { once: true })
        try {
          Speech.speak(value, {
            onDone: () => done(),
            onStopped: () => done(),
            onError: (error) => done(error),
            useApplicationAudioSession: false,
            language: dictation.getSnapshot().locale,
          })
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
  }
}
