import { Schema } from 'effect'
import { decodeResult } from './shared/schema.js'

export const dictationModel = {
  name: 'Nemotron 3.5 ASR Streaming',
  filename: 'nemotron-3.5-asr-streaming-0.6b-q8.gguf',
  bytes: 751094240,
  sha256: 'b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c',
  url: 'https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/53ce288f69326b415aeef030cfcb02a08a8096dd/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
} as const
export function dictationDownloadProgress(downloaded: number) {
  return Math.max(0, Math.min(99, Math.floor((downloaded / dictationModel.bytes) * 100)))
}

export const dictationLanguages = [
  ['auto', 'Automatic'],
  ['nl-NL', 'Dutch'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['ar-AR', 'Arabic'],
  ['bg-BG', 'Bulgarian'],
  ['zh-CN', 'Chinese (Mandarin)'],
  ['hr-HR', 'Croatian'],
  ['cs-CZ', 'Czech'],
  ['da-DK', 'Danish'],
  ['et-EE', 'Estonian'],
  ['fi-FI', 'Finnish'],
  ['fr-FR', 'French'],
  ['fr-CA', 'French (Canada)'],
  ['de-DE', 'German'],
  ['el-GR', 'Greek'],
  ['hi-IN', 'Hindi'],
  ['hu-HU', 'Hungarian'],
  ['it-IT', 'Italian'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['nb-NO', 'Norwegian Bokmål'],
  ['pl-PL', 'Polish'],
  ['pt-PT', 'Portuguese'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['ro-RO', 'Romanian'],
  ['ru-RU', 'Russian'],
  ['sk-SK', 'Slovak'],
  ['es-ES', 'Spanish'],
  ['es-US', 'Spanish (US)'],
  ['sv-SE', 'Swedish'],
  ['tr-TR', 'Turkish'],
  ['uk-UA', 'Ukrainian'],
  ['vi-VN', 'Vietnamese'],
] as const
export const dictationLanguageSchema = Schema.Literals(dictationLanguages.map(([code]) => code))
export type DictationLanguage = typeof dictationLanguageSchema.Type
export const dictationProviderSchema = Schema.Literals(['nemotron', 'apple'])
export type DictationProvider = typeof dictationProviderSchema.Type
export const botVoicePauseOptions = [1100, 1500, 2000, 3000, 5000] as const
export const botVoicePauseSchema = Schema.Literals(botVoicePauseOptions)
export type BotVoicePause = typeof botVoicePauseSchema.Type
export const dictationUpdateSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('error'), message: Schema.String }),
])
export type DictationUpdate = typeof dictationUpdateSchema.Type
export const dictationStatusSchema = Schema.Struct({
  engine: Schema.Boolean,
  model: Schema.Boolean,
  downloading: Schema.Boolean,
  downloaded: Schema.Number,
  appleSpeech: Schema.optional(Schema.Literal(true)),
})
export type DictationStatus = typeof dictationStatusSchema.Type
export type DesktopDictationBridge = {
  status: () => Promise<DictationStatus>
  install: (id: string) => Promise<void>
  start: (id: string, language: DictationLanguage, provider?: DictationProvider) => Promise<void>
  feed: (id: string, pcm: ArrayBuffer) => Promise<void>
  finish: (id: string) => Promise<string>
  subscribe: (id: string, listener: (update: DictationUpdate) => void) => () => void
  cancel: (id: string) => Promise<void>
}

const bridgeSchema = Schema.Struct({
  dovo: Schema.Struct({
    dictation: Schema.Unknown.pipe(
      Schema.refine(
        (value): value is DesktopDictationBridge =>
          typeof value === 'object' &&
          value !== null &&
          ['status', 'install', 'start', 'feed', 'finish', 'subscribe', 'cancel'].every(
            (key) => key in value && typeof Reflect.get(value, key) === 'function',
          ),
      ),
    ),
  }),
})
export function desktopDictationBridge(provider: DictationProvider = 'nemotron') {
  const result = decodeResult(bridgeSchema, globalThis)
  if (!result.success) return undefined
  const bridge = result.data.dovo.dictation
  if (provider === 'nemotron') return bridge
  return {
    ...bridge,
    status: async () => {
      const status = await bridge.status()
      return { ...status, engine: status.appleSpeech === true, model: status.appleSpeech === true }
    },
    start: (id: string, language: DictationLanguage) => bridge.start(id, language, 'apple'),
  }
}
