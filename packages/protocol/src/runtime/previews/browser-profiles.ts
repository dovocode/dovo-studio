import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
export const browserProfileIdSchema = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/))
export const browserProfileSchema = mutableStruct({
  id: browserProfileIdSchema,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100), Schema.pattern(/\S/)),
})
export const defaultBrowserProfiles = () => [{ id: 'default', name: 'Default' }]
export const browserProfilesSchema = mutableArray(browserProfileSchema).pipe(
  Schema.minItems(1),
  Schema.filter(
    (profiles) =>
      profiles.some((profile) => profile.id === 'default') &&
      new Set(profiles.map((profile) => profile.id)).size === profiles.length,
  ),
)
export const browserProfilesResultSchema = mutableStruct({ profiles: browserProfilesSchema })
export type BrowserProfile = Schema.Schema.Type<typeof browserProfileSchema>
