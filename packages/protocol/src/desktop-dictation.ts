import { Schema } from 'effect'
import { decodeResult } from './shared/schema.js'

export const dictationModel = {
  name: 'Parakeet Redux',
  bytes: 159121504,
  sha256: '74f43ba852479e86e29df92cdbc89aa8215c7e8070f711be424ff466415b6184',
  url: 'https://huggingface.co/Nairod785/parakeet-redux-gguf/resolve/87cbc354ce32bc9fe144b5b7bcdd9c68538907a9/parakeet-redux-0.6b-TQ1_Q8_0.gguf',
} as const
export const dictationStatusSchema = Schema.Struct({
  engine: Schema.Boolean,
  model: Schema.Boolean,
  downloading: Schema.Boolean,
  downloaded: Schema.Number,
})
export type DictationStatus = typeof dictationStatusSchema.Type
export type DesktopDictationBridge = {
  status: () => Promise<DictationStatus>
  install: (id: string) => Promise<void>
  transcribe: (id: string, pcm: ArrayBuffer) => Promise<string>
  cancel: (id: string) => Promise<void>
}

const bridgeSchema = Schema.Struct({
  dovo: Schema.Struct({
    dictation: Schema.Unknown.pipe(
      Schema.refine(
        (value): value is DesktopDictationBridge =>
          typeof value === 'object' &&
          value !== null &&
          ['status', 'install', 'transcribe', 'cancel'].every(
            (key) => key in value && typeof Reflect.get(value, key) === 'function',
          ),
      ),
    ),
  }),
})
export function desktopDictationBridge() {
  const result = decodeResult(bridgeSchema, globalThis)
  return result.success ? result.data.dovo.dictation : undefined
}
