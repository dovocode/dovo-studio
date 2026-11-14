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
      signal.throwIfAborted()
      const id = randomUUID()
      // Record locally while the previous utterance finishes transcription. Serialize
      // bridge sessions so a new recording cannot replace its predecessor's decoder.
      const ready = cleanup.then(async () => {
        signal.throwIfAborted()
        await bridge.start(id, language)
      })
      let recorder: Awaited<ReturnType<typeof recordDictation>> | undefined
      let released = false,
        stopped = false,
        voiced = 0,
        quiet = 0,
        samples = 0
      let announcedSpeech = false
      let feeds = ready
      const report = (error: unknown) => {
        if (!signal.aborted) events.error(error instanceof Error ? error : new Error(String(error)))
      }
      const release = () => {
        if (released) return
        released = true
        stopped = true
        recorder?.cancel()
        cleanup = ready
          .then(
            () => bridge.cancel(id),
            () => bridge.cancel(id),
          )
          .catch(report)
      }
      signal.addEventListener('abort', release, { once: true })
      void ready.catch((error) => {
        release()
        report(error)
      })
      const finish = () => {
        if (stopped || !recorder) return
        stopped = true
        const recording = recorder
        const work = async () => {
          try {
            await recording.stop()
            if (!signal.aborted) events.released?.()
            await feeds
            if (signal.aborted) {
              await bridge.cancel(id)
              return
            }
            const text = voiced < 3200 ? (await bridge.cancel(id), '') : await bridge.finish(id)
            signal.removeEventListener('abort', release)
            if (!signal.aborted) events.finish(text)
          } catch (error) {
            try {
              await bridge.cancel(id)
            } catch (cancelError) {
              report(new Error(`Could not stop transcription: ${String(cancelError)}`))
            }
            report(error)
          } finally {
            signal.removeEventListener('abort', release)
          }
        }
        cleanup = work()
      }
      try {
        recorder = await recordDictation(
          signal,
          finish,
          (error) => {
            release()
            report(error)
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
              if (!announcedSpeech && voiced >= 3200) {
                announcedSpeech = true
                events.speechStarted?.()
              }
            } else quiet += count
            samples += count
            feeds = feeds.then(() => bridge.feed(id, pcm))
            void feeds.catch((error) => {
              if (!stopped) {
                release()
                report(error)
              }
            })
            if ((voiced >= 3200 && quiet >= 17600) || samples >= 480000) finish()
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
