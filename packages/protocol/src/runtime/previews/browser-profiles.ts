import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
export const browserProfileIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/)),
)
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
export const browserProfileSchema = mutableStruct({
  id: browserProfileIdSchema,
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(100)),
    Schema.check(Schema.isPattern(/\S/)),
  ),
  language: Schema.optional(browserLanguageSchema),
})
export const defaultBrowserProfiles = () => [{ id: 'default', name: 'Default' }]
export const browserProfilesSchema = mutableArray(browserProfileSchema).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(
    Schema.makeFilter(
      (profiles) =>
        profiles.some((profile) => profile.id === 'default') &&
        new Set(profiles.map((profile) => profile.id)).size === profiles.length,
    ),
  ),
)
export const browserProfilesResultSchema = mutableStruct({ profiles: browserProfilesSchema })
export type BrowserProfile = Schema.Schema.Type<typeof browserProfileSchema>
