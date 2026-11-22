import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, refine, strictStruct } from '../shared/schema.js'

const text = maxValue(Schema.String, 4096)
export const studioHttpUrlSchema = refine(
  text,
  (value) => {
    if (!/^https?:\/\//i.test(value) || value !== value.trim()) return false
    try {
      const parsed = new URL(value)
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !parsed.username &&
        !parsed.password
      )
    } catch {
      return false
    }
  },
  'Enter an HTTP or HTTPS URL without credentials',
)
const chart = Schema.Literals(['table', 'number', 'line'])
const pointerPattern = /^(?:\/(?:[^~]|~[01])*)+$/
const panel = strictStruct({
  title: maxValue(minValue(Schema.String, 1), 100),
  pointer: refine(text, (value) => !value || pointerPattern.test(value), 'Use a JSON pointer'),
  chart,
})
export const studioDataPanelLimit = 8
export const studioDataPanelsSchema = minValue(
  maxValue(mutableArray(panel), studioDataPanelLimit),
  1,
)
export type StudioDataPanel = typeof panel.Type

export const studioDataDisplay = {
  chart,
  pointer: text,
  panels: Schema.optionalKey(studioDataPanelsSchema),
}
const refreshSeconds = Schema.optionalKey(
  Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 86400 })),
)
export const studioCommandFields = {
  repositoryId: text,
  command: maxValue(minValue(Schema.String, 1), 20000),
}
export const studioApiDataFields = {
  kind: Schema.Literal('api'),
  url: studioHttpUrlSchema,
  refreshSeconds,
  ...studioDataDisplay,
}
export const studioCliDataFields = {
  kind: Schema.Literal('cli'),
  ...studioCommandFields,
  refreshSeconds,
  ...studioDataDisplay,
}

const studioDataSourceSchema = Schema.Union([
  strictStruct(studioApiDataFields),
  strictStruct(studioCliDataFields),
])
export type StudioDataSource = typeof studioDataSourceSchema.Type

export function isStudioDataSource<T extends { kind: string }>(
  value: T,
): value is Extract<T, { kind: 'api' | 'cli' }> {
  return value.kind === 'api' || value.kind === 'cli'
}

export function studioDataSourceIssue(source: StudioDataSource) {
  if (source.kind === 'cli' && (!source.repositoryId.trim() || !source.command.trim()))
    return 'Choose a project and enter a command'
  if (source.pointer && !pointerPattern.test(source.pointer))
    return 'Use an RFC 6901 JSON pointer, or leave it empty for the whole value'
}
