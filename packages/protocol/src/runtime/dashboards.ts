import { extensionKeySchema } from './studio-extension-views.js'
import { Schema } from 'effect'
import {
  isStudioDataSource,
  studioApiDataFields,
  studioCliDataFields,
  studioCommandFields,
  studioDataDisplay,
  studioHttpUrlSchema,
} from './studio-data-sources.js'
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
const tile = { id: uuidSchema, title, span: size, height: size }

export const dashboardTileSchema = Schema.Union([
  strictStruct({ ...tile, ...studioApiDataFields }),
  strictStruct({ ...tile, ...studioCliDataFields }),
  strictStruct({
    ...tile,
    ...studioDataDisplay,
    kind: Schema.Literal('mcp'),
    taskId: text,
    server: text,
    tool: text,
    arguments: text,
  }),
  strictStruct({ ...tile, ...studioCommandFields, kind: Schema.Literal('command') }),
  strictStruct({ ...tile, ...studioCommandFields, kind: Schema.Literal('tui') }),
  strictStruct({ ...tile, kind: Schema.Literal('terminal'), terminalId: text }),
  strictStruct({ ...tile, kind: Schema.Literal('iframe'), url: studioHttpUrlSchema }),
  strictStruct({ ...tile, kind: Schema.Literal('browser'), url: studioHttpUrlSchema }),
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

export function needsStudioDataSources(dashboard: Dashboard) {
  return dashboard.tiles.some(
    (tile) =>
      ('panels' in tile && tile.panels !== undefined) ||
      (isStudioDataSource(tile) && (tile.kind === 'cli' || tile.refreshSeconds !== undefined)),
  )
}

export const dashboardListRequestSchema = strictStruct({
  dataSources: Schema.optionalKey(Schema.Literal(true)),
})
export const dashboardSaveRequestSchema = strictStruct({
  dashboard: dashboardSchema,
  expectedRevision: revision,
  requestId: Schema.optionalKey(uuidSchema),
})
export const dashboardDeleteRequestSchema = strictStruct({
  id: uuidSchema,
  expectedRevision: revision,
})
export const dashboardReadRequestSchema = strictStruct({
  id: uuidSchema,
  tileId: uuidSchema,
  expectedRevision: revision,
  automatic: Schema.optionalKey(Schema.Boolean),
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
  refreshAfterMs: Schema.optionalKey(Schema.Number),
})
export const dashboardRunResultSchema = strictStruct({ terminalId: text })
export const dashboardSessionResultSchema = strictStruct({ terminalId: Schema.NullOr(text) })
