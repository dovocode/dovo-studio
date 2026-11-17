import { Schema } from 'effect'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'
import { jiraIssueFiltersSchema } from './forges/jira.js'

const text = maxValue(Schema.String, 2000)
export const savedFilterValuesSchema = mutableStruct({
  source: text,
  state: text,
  search: maxValue(Schema.String, 300),
  sort: text,
  draft: Schema.optional(text),
  attention: Schema.optional(Schema.Boolean),
  personal: Schema.optional(Schema.Literals(['all', 'authored', 'assigned', 'involved', 'review'])),
  linked: Schema.optional(text),
  jiraFilters: Schema.optional(jiraIssueFiltersSchema),
  layout: Schema.optional(Schema.Literals(['list', 'board', 'status'])),
})
export const savedFilterViewSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  name: maxValue(minValue(Schema.String, 1), 80),
  kind: Schema.Literals(['pulls', 'issues', 'jira']),
  scope: maxValue(Schema.String, 64),
  sourceScope: Schema.optional(maxValue(Schema.String, 64)),
  filters: savedFilterValuesSchema,
})
export const savedFilterViewsSchema = maxValue(mutableArray(savedFilterViewSchema), 100)
export type SavedFilterView = typeof savedFilterViewSchema.Type
export type SavedFilterValues = typeof savedFilterValuesSchema.Type
/** Hash account/connection identities before storing the scope in local preferences. */
export const savedFilterScope = (identities: readonly string[]) =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify([...identities].sort()))))

export function saveFilterView(
  views: readonly SavedFilterView[],
  view: SavedFilterView,
): SavedFilterView[] {
  const name = view.name.trim()
  if (!name || name.length > 80) throw new Error('Use a name with 1 to 80 characters.')
  if (
    views.some(
      (item) =>
        item.id !== view.id &&
        item.kind === view.kind &&
        item.scope === view.scope &&
        item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new Error('A view with this name already exists.')
  if (!views.some((item) => item.id === view.id) && views.length >= 100)
    throw new Error('Remove a saved view before adding another. The limit is 100.')
  return [...views.filter((item) => item.id !== view.id), { ...view, name }]
}

export type SavedFilterSource = { key: string; identity: string }
export function savedFilterSourceScope(source: string, sources: readonly SavedFilterSource[]) {
  const found = sources.find((item) => item.key === source)
  return found ? savedFilterScope([found.identity]) : undefined
}
export function availableSavedFilterView(
  view: SavedFilterView,
  scope: string,
  sources: readonly SavedFilterSource[],
) {
  return view.filters.source
    ? !!view.sourceScope &&
        view.sourceScope === savedFilterSourceScope(view.filters.source, sources)
    : view.scope === scope
}
