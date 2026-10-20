const sampleRate = 16000
const maxSamples = sampleRate * 300

/** Capture only 16 kHz mono PCM. The worklet's output is silent, avoiding microphone feedback. */
export async function recordDictation(
  signal: AbortSignal,
  onLimit: () => void,
  onFailure: (error: Error) => void,
  onAudio: (pcm: ArrayBuffer) => void,
) {
  signal.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  })
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop())
    signal.throwIfAborted()
  }
  let context: AudioContext | undefined
  let node: AudioWorkletNode | undefined
  let length = 0
  let stopped = false
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  let flushed: (() => void) | undefined
  const failed = () => {
    if (stopped) return
    cancel()
    onFailure(new Error('The microphone disconnected or stopped processing. Please record again.'))
  }
  const release = () => {
    clearTimeout(limitTimer)
    stream.getTracks().forEach((track) => track.removeEventListener('ended', failed))
    stream.getTracks().forEach((track) => track.stop())
    node?.disconnect()
    if (context && context.state !== 'closed')
      void context
        .close()
        .catch((error: unknown) => console.error('Could not close dictation audio:', error))
    signal.removeEventListener('abort', cancel)
  }
  const cancel = () => {
    stopped = true
    flushed?.()
    release()
  }
  signal.addEventListener('abort', cancel, { once: true })
  const module = URL.createObjectURL(
    new Blob(
      [
        `
    class DictationCapture extends AudioWorkletProcessor {
      constructor() {
        super(); this.buffer = new Float32Array(2048); this.length = 0;
        this.port.onmessage = () => { this.flush(); this.port.postMessage('flushed'); };
      }
      flush() { if (this.length) this.port.postMessage(this.buffer.slice(0, this.length)); this.length = 0; }
      process(inputs) {
        const input = inputs[0]?.[0];
        if (input) for (const sample of input) { this.buffer[this.length++] = sample; if (this.length === this.buffer.length) this.flush(); }
        return true;
      }
    }
    registerProcessor('dictation-capture', DictationCapture);
  `,
      ],
      { type: 'text/javascript' },
    ),
  )
  try {
    context = new AudioContext({ sampleRate })
    if (context.sampleRate !== sampleRate)
      throw new Error('This audio device cannot record at 16 kHz.')
    await context.audioWorklet.addModule(module)
    signal.throwIfAborted()
    node = new AudioWorkletNode(context, 'dictation-capture')
    node.onprocessorerror = failed
    stream.getTracks().forEach((track) => track.addEventListener('ended', failed, { once: true }))
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'flushed') {
        flushed?.()
        return
      }
      if (stopped || !(event.data instanceof Float32Array)) return
      const count = Math.min(event.data.length, maxSamples - length)
      if (count <= 0) return
      const pcm = new ArrayBuffer(count * 2)
      const view = new DataView(pcm)
      for (let i = 0; i < count; i++) {
        const value = Math.max(-1, Math.min(1, event.data[i]))
        view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      onAudio(pcm)
      length += count
      if (length === maxSamples) onLimit()
    }
    context.createMediaStreamSource(stream).connect(node)
    node.connect(context.destination)
    await context.resume()
    signal.throwIfAborted()
    limitTimer = setTimeout(onLimit, 300_000)
    return {
      cancel,
      stop: async () => {
        if (stopped) throw new Error('Recording was cancelled.')
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await new Promise<void>((resolve, reject) => {
            flushed = resolve
            timer = setTimeout(
              () => reject(new Error('The microphone did not finish recording. Please try again.')),
              1500,
            )
            node!.port.postMessage('flush')
          })
          signal.throwIfAborted()
          stopped = true
        } finally {
          clearTimeout(timer)
          release()
        }
      },
    }
  } catch (error) {
    cancel()
    throw error
  } finally {
    URL.revokeObjectURL(module)
  }
}

export function insertDictation(draft: string, transcript: string, start: number, end: number) {
  const before = draft.slice(0, start),
    after = draft.slice(end)
  return (
    before +
    (before && !/\s$/.test(before) ? ' ' : '') +
    transcript.trim() +
    (after && !/^[\s.,!?;:)}\]]/.test(after) ? ' ' : '') +
    after
  )
}
