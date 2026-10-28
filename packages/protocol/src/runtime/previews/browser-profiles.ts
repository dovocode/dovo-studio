import { browserSearchEngineSchema } from './browser-search.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
export const browserProfileIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/)),
)
/** An exact HTTP(S) origin: paths, wildcards and credentials are intentionally unsupported. */
export const browserWebsiteOriginSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2048)),
  Schema.check(
    Schema.makeFilter((value) => {
      try {
        const url = new URL(value)
        return /^https?:$/.test(url.protocol) && !url.hostname.includes('*') && url.origin === value
      } catch {
        return false
      }
    }),
  ),
)
export const browserWebsiteCustomizationSchema = mutableStruct({
  origin: browserWebsiteOriginSchema,
  enabled: Schema.Boolean,
  css: Schema.String.pipe(Schema.check(Schema.isMaxLength(64000))),
  script: Schema.String.pipe(Schema.check(Schema.isMaxLength(64000))),
})
export type BrowserWebsiteCustomization = Schema.Schema.Type<
  typeof browserWebsiteCustomizationSchema
>
export const isPrivateBrowserProfile = (id: string) =>
  /^private-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
export const browserLanguageSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100)),
  Schema.check(
    Schema.makeFilter((value) => {
      try {
        return Intl.getCanonicalLocales(value).length === 1
      } catch {
        return false
      }
    }),
  ),
)
export function browserLanguages(language = 'en-US') {
  const locale = Intl.getCanonicalLocales(language)[0] ?? 'en-US'
  return [...new Set([locale, locale.split('-')[0]!])]
}
/** Canonical host, optional *. subdomains, and optional case-sensitive path prefix. */
export function normalizeBrowserLinkDomain(input: string): string | undefined {
  const value = input.trim()
  const wildcard = value.startsWith('*.')
  const rule = wildcard ? value.slice(2) : value
  const slash = rule.indexOf('/')
  const host = slash < 0 ? rule : rule.slice(0, slash)
  const path = slash < 0 ? '' : rule.slice(slash)
  if (!host || /[\s/?#@:*\\]/.test(host) || /[\s?#\\*]/.test(path)) return undefined
  try {
    const url = new URL(`http://${host}${path}`)
    const domain = url.hostname.replace(/\.$/, '')
    if (!domain || domain.length > 253 || url.port || domain.includes('..')) return undefined
    const prefix = url.pathname.replace(/\/+$/, '')
    return `${wildcard ? '*.' : ''}${domain}${prefix}`
  } catch {
    return undefined
  }
}
export const browserLinkDomainSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2048)),
  Schema.check(Schema.makeFilter((value) => normalizeBrowserLinkDomain(value) === value)),
)
/** One displayable emoji, including flags, skin tones and joined sequences. */
export const browserProfileEmojiSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(32)),
  Schema.check(
    Schema.makeFilter(
      (value) =>
        [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length ===
          1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(value),
    ),
  ),
)
export const browserProfileSchema = mutableStruct({
  id: browserProfileIdSchema,
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(100)),
    Schema.check(Schema.isPattern(/\S/)),
  ),
  emoji: Schema.optional(browserProfileEmojiSchema),
  language: Schema.optional(browserLanguageSchema),
  search: Schema.optional(browserSearchEngineSchema),
  linkDomains: Schema.optional(
    mutableArray(browserLinkDomainSchema).pipe(
      Schema.check(Schema.isMaxLength(64)),
      Schema.check(Schema.makeFilter((domains) => new Set(domains).size === domains.length)),
    ),
  ),
  websites: Schema.optional(
    mutableArray(browserWebsiteCustomizationSchema).pipe(
      Schema.check(Schema.isMaxLength(64)),
      Schema.check(
        Schema.makeFilter(
          (sites) => new Set(sites.map((site) => site.origin)).size === sites.length,
        ),
      ),
    ),
  ),
})
export const defaultBrowserProfiles = () => [{ id: 'default', name: 'Default' }]
export const browserProfilesSchema = mutableArray(browserProfileSchema).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(
    Schema.makeFilter(
      (profiles) =>
        profiles.some((profile) => profile.id === 'default') &&
        new Set(profiles.map((profile) => profile.id)).size === profiles.length &&
        new Set(profiles.flatMap((profile) => profile.linkDomains ?? [])).size ===
          profiles.flatMap((profile) => profile.linkDomains ?? []).length,
    ),
  ),
)
export const browserProfilesResultSchema = mutableStruct({ profiles: browserProfilesSchema })
export type BrowserProfile = Schema.Schema.Type<typeof browserProfileSchema>

/** Match only a new HTTP(S) link; never move an existing private session into another profile. */
export function browserLinkProfile(
  url: string,
  profiles: readonly BrowserProfile[],
  sourceProfileId?: string,
): string | undefined {
  if (sourceProfileId && isPrivateBrowserProfile(sourceProfileId)) return undefined
  let host: string
  let path: string
  try {
    const target = new URL(url)
    if (!/^https?:$/.test(target.protocol)) return undefined
    host = target.hostname.toLowerCase().replace(/\.$/, '')
    path = target.pathname
  } catch {
    return undefined
  }
  let match: { profileId: string; specificity: number; pathLength: number } | undefined
  for (const profile of profiles) {
    if (isPrivateBrowserProfile(profile.id)) continue
    for (const rule of profile.linkDomains ?? []) {
      const slash = rule.indexOf('/')
      const domain = slash < 0 ? rule : rule.slice(0, slash)
      const prefix = slash < 0 ? '' : rule.slice(slash)
      const wildcard = domain.startsWith('*.')
      if (wildcard ? !host.endsWith(domain.slice(1)) : host !== domain) continue
      if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) continue
      const specificity = wildcard ? domain.length - 2 : 1000 + domain.length
      if (
        !match ||
        prefix.length > match.pathLength ||
        (prefix.length === match.pathLength && specificity > match.specificity)
      )
        match = { profileId: profile.id, specificity, pathLength: prefix.length }
    }
  }
  return match?.profileId
}
