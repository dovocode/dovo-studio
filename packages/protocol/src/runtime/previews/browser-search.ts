import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'

export const browserSearchProviders = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
] as const

export function validBrowserSearchTemplate(value: string) {
  if (!value.includes('%s') || value.trim() !== value || value.length > 4096) return false
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
export const browserSearchTemplateSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validBrowserSearchTemplate)),
)
export const browserSearchEngineSchema = Schema.Union([
  mutableStruct({ engine: Schema.Literals(['google', 'duckduckgo', 'kagi']) }),
  mutableStruct({ engine: Schema.Literal('custom'), url: browserSearchTemplateSchema }),
])
export type BrowserSearchEngine = Schema.Schema.Type<typeof browserSearchEngineSchema>

/** Only search terms are substituted; explicit addresses never pass through this function. */
export function browserSearchUrl(input: string, search?: BrowserSearchEngine) {
  const template =
    search?.engine === 'custom'
      ? search.url
      : browserSearchProviders.find((provider) => provider.id === (search?.engine ?? 'google'))!.url
  if (!validBrowserSearchTemplate(template))
    throw new Error('Use an HTTP or HTTPS search URL containing %s, without credentials.')
  const url = new URL(template.replaceAll('%s', encodeURIComponent(input))).href
  if (url.length > 4096) throw new Error('Browser addresses must be at most 4096 characters.')
  return url
}
