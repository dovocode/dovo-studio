import { dictationLanguages, dictationLanguageSchema } from './desktop-dictation.js'
/** Keep interface choices aligned with the ASR catalog. Speech has its own saved choice. */
export const interfaceLanguageSchema = dictationLanguageSchema
export type InterfaceLanguage = typeof interfaceLanguageSchema.Type
const nativeNames: Record<string, string> = {
  auto: 'Automatic',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'nl-NL': 'Nederlands',
  'ar-AR': 'العربية',
  'bg-BG': 'Български',
  'zh-CN': '中文（普通话）',
  'hr-HR': 'Hrvatski',
  'cs-CZ': 'Čeština',
  'da-DK': 'Dansk',
  'et-EE': 'Eesti',
  'fi-FI': 'Suomi',
  'fr-FR': 'Français',
  'fr-CA': 'Français (Canada)',
  'de-DE': 'Deutsch',
  'el-GR': 'Ελληνικά',
  'hi-IN': 'हिन्दी',
  'hu-HU': 'Magyar',
  'it-IT': 'Italiano',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'nb-NO': 'Norsk bokmål',
  'pl-PL': 'Polski',
  'pt-PT': 'Português',
  'pt-BR': 'Português (Brasil)',
  'ro-RO': 'Română',
  'ru-RU': 'Русский',
  'sk-SK': 'Slovenčina',
  'es-ES': 'Español',
  'es-US': 'Español (EE. UU.)',
  'sv-SE': 'Svenska',
  'tr-TR': 'Türkçe',
  'uk-UA': 'Українська',
  'vi-VN': 'Tiếng Việt',
}
export const interfaceLanguages = dictationLanguages.map(([id, name]) => ({
  id,
  name: nativeNames[id] ?? name,
}))
export function resolveInterfaceLanguage(
  language: InterfaceLanguage,
  deviceLanguages: readonly string[] = [],
) {
  if (language !== 'auto') return language
  for (const locale of deviceLanguages) {
    const exact = interfaceLanguages.find((item) => item.id.toLowerCase() === locale.toLowerCase())
    if (exact) return exact.id
    const base = locale.toLowerCase().split('-')[0]
    const match = interfaceLanguages.find((item) => item.id.split('-')[0] === base)
    if (match) return match.id
  }
  return 'en-US'
}
