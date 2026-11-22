import { extensionKeySchema } from './studio-extension-views.js'
import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableArray,
  refine,
  strictStruct,
  uuidSchema,
} from '../shared/schema.js'

const text = maxValue(Schema.String, 4096)
const title = maxValue(minValue(Schema.String, 1), 100)
const revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
const size = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 4 })))
const url = refine(
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

const tile = { id: uuidSchema, title, span: size, height: size }
const data = { chart: Schema.Literals(['table', 'number', 'line']), pointer: text }
const command = { repositoryId: text, command: maxValue(minValue(Schema.String, 1), 20000) }

export const dashboardTileSchema = Schema.Union([
  strictStruct({ ...tile, ...data, kind: Schema.Literal('api'), url }),
  strictStruct({
    ...tile,
    ...data,
    kind: Schema.Literal('mcp'),
    taskId: text,
    server: text,
    tool: text,
    arguments: text,
  }),
  strictStruct({ ...tile, ...command, kind: Schema.Literal('command') }),
  strictStruct({ ...tile, ...command, kind: Schema.Literal('tui') }),
  strictStruct({ ...tile, kind: Schema.Literal('terminal'), terminalId: text }),
  strictStruct({ ...tile, kind: Schema.Literal('iframe'), url }),
  strictStruct({ ...tile, kind: Schema.Literal('browser'), url }),
  strictStruct({ ...tile, kind: Schema.Literal('gui') }),
  strictStruct({
    ...tile,
    kind: Schema.Literal('extension'),
    extensionId: extensionKeySchema,
    contributionId: extensionKeySchema,
  }),
  strictStruct({ ...tile, kind: Schema.Literal('app'), taskId: text, appId: text }),
  strictStruct({ ...tile, kind: Schema.Literal('pipelines'), repositoryId: text }),
  strictStruct({ ...tile, kind: Schema.Literal('threads') }),
  strictStruct({ ...tile, kind: Schema.Literal('jobs') }),
])

export const dashboardSchema = strictStruct({
  id: uuidSchema,
  title,
  revision,
  tiles: refine(
    maxValue(mutableArray(dashboardTileSchema), 32),
    (tiles) => new Set(tiles.map((entry) => entry.id)).size === tiles.length,
    'Tile IDs must be unique',
  ),
})
export type Dashboard = typeof dashboardSchema.Type
export type DashboardTile = typeof dashboardTileSchema.Type

export const dashboardListRequestSchema = strictStruct({})
export const dashboardSaveRequestSchema = strictStruct({
  dashboard: dashboardSchema,
  expectedRevision: revision,
})
export const dashboardDeleteRequestSchema = strictStruct({
  id: uuidSchema,
  expectedRevision: revision,
})
export const dashboardReadRequestSchema = strictStruct({
  id: uuidSchema,
  tileId: uuidSchema,
  expectedRevision: revision,
})
export const dashboardRunRequestSchema = strictStruct({
  id: uuidSchema,
  tileId: uuidSchema,
  expectedRevision: revision,
  requestId: uuidSchema,
})
export const dashboardListResultSchema = strictStruct({ dashboards: mutableArray(dashboardSchema) })
export const dashboardSaveResultSchema = strictStruct({ dashboard: dashboardSchema })
export const dashboardDeleteResultSchema = strictStruct({ ok: Schema.Literal(true) })
export const dashboardReadResultSchema = strictStruct({
  data: Schema.Unknown,
  updatedAt: Schema.Number,
})
export const dashboardRunResultSchema = strictStruct({ terminalId: text })
export const dashboardSessionResultSchema = strictStruct({ terminalId: Schema.NullOr(text) })
