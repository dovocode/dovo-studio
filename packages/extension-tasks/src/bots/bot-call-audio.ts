import { botCallSpeech, type BotCallAudio } from '@dovo/client-runtime'
import { randomUUID, type DesktopDictationBridge, type DictationLanguage } from '@dovo/protocol'
import { recordDictation } from '../chat/composer/dictation-audio'

/** Transcription uses the selected local/runtime bridge. Speech uses this device's system voices. */
export function browserBotCallAudio(
  bridge: DesktopDictationBridge | undefined,
  language: DictationLanguage,
): BotCallAudio {
  let cleanup: Promise<unknown> = Promise.resolve()
  return {
    async listen(signal, events) {
      if (!bridge) throw Error('Choose a speech computer in Settings → Speech before calling.')
      if (!globalThis.speechSynthesis) throw Error('This device does not support spoken replies.')
      await cleanup
      signal.throwIfAborted()
      const id = randomUUID()
      await bridge.start(id, language)
      let recorder: Awaited<ReturnType<typeof recordDictation>> | undefined
      let released = false
      let stopped = false,
        voiced = 0,
        quiet = 0,
        samples = 0
      let feeds = Promise.resolve()
      const release = () => {
        if (released) return
        released = true
        stopped = true
        recorder?.cancel()
        cleanup = bridge.cancel(id).catch((error) => {
          if (!signal.aborted)
            events.error(error instanceof Error ? error : new Error(String(error)))
        })
      }
      signal.addEventListener('abort', release, { once: true })
      const finish = async () => {
        if (stopped || !recorder) return
        stopped = true
        try {
          await recorder.stop()
          await feeds
          if (signal.aborted) {
            await bridge.cancel(id)
            return
          }
          if (voiced < 3200) {
            await bridge.cancel(id)
            events.finish('')
            return
          }
          const text = await bridge.finish(id)
          if (!signal.aborted) events.finish(text)
        } catch (error) {
          await bridge.cancel(id).catch((cancelError) => {
            if (!signal.aborted)
              events.error(new Error(`Could not stop transcription: ${String(cancelError)}`))
          })
          if (!signal.aborted)
            events.error(error instanceof Error ? error : new Error(String(error)))
        } finally {
          signal.removeEventListener('abort', release)
        }
      }
      try {
        recorder = await recordDictation(
          signal,
          () => void finish(),
          (error) => {
            release()
            events.error(error)
          },
          (pcm) => {
            const data = new DataView(pcm),
              count = pcm.byteLength / 2
            let sum = 0
            for (let at = 0; at < pcm.byteLength; at += 2)
              sum += (data.getInt16(at, true) / 32768) ** 2
            const speech = Math.sqrt(sum / count) > 0.015
            if (speech) {
              voiced += count
              quiet = 0
            } else quiet += count
            samples += count
            feeds = feeds.then(() => bridge.feed(id, pcm))
            void feeds.catch((error) => {
              if (!stopped) {
                release()
                events.error(error instanceof Error ? error : new Error(String(error)))
              }
            })
            if ((voiced >= 3200 && quiet >= 17600) || samples >= 480000) void finish()
          },
        )
        if (stopped || signal.aborted) {
          recorder.cancel()
          await bridge.cancel(id)
        }
      } catch (error) {
        release()
        throw error
      }
    },
    async speak(text, signal) {
      const value = botCallSpeech(text)
      if (!value) return
      signal.throwIfAborted()
      const synth = globalThis.speechSynthesis
      if (!synth) throw Error('This device does not support spoken replies.')
      return new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(value)
        if (language !== 'auto') utterance.lang = language
        const stop = () => {
          synth.cancel()
          done()
        }
        const done = (error?: Error) => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', stop)
          if (error) reject(error)
          else resolve()
        }
        const timeout = setTimeout(() => {
          synth.cancel()
          done(new Error('Speech playback timed out. Read the reply in chat.'))
        }, 180000)
        utterance.onend = () => done()
        utterance.onerror = (event) => {
          if (signal.aborted) done()
          else done(new Error(`Speech playback failed: ${event.error}. Check system voices.`))
        }
        signal.addEventListener('abort', stop, { once: true })
        try {
          synth.speak(utterance)
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
  }
}
