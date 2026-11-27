import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { dashboardSchema, decode, strictStruct, uuidSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Dashboards } from './dashboards.js'

const revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))
const draft = Schema.Record(Schema.String, Schema.Unknown)
const commands = {
  list: strictStruct({ action: Schema.Literal('list') }),
  read: strictStruct({ action: Schema.Literal('read'), id: uuidSchema }),
  create: strictStruct({
    action: Schema.Literal('create'),
    dashboard: draft,
    requestId: Schema.optionalKey(uuidSchema),
  }),
  update: strictStruct({
    action: Schema.Literal('update'),
    id: uuidSchema,
    expectedRevision: revision,
    dashboard: draft,
    requestId: Schema.optionalKey(uuidSchema),
  }),
  delete: strictStruct({
    action: Schema.Literal('delete'),
    id: uuidSchema,
    expectedRevision: revision,
  }),
}
export type AgentDashboardAction = keyof typeof commands
export const agentDashboardReadActions: readonly AgentDashboardAction[] = ['list', 'read']
const isAction = (value: unknown): value is AgentDashboardAction =>
  typeof value === 'string' && Object.hasOwn(commands, value)

export function agentDashboardAction(command: unknown): AgentDashboardAction {
  const action =
    command && typeof command === 'object' && 'action' in command ? command.action : undefined
  if (!isAction(action)) throw new HttpError(400, 'Choose list, read, create, update or delete')
  return action
}

/**
 * The runtime assigns the dashboard ID and revision, and an ID for each new tile. Tiles keep
 * the IDs the agent read, so clients keep their layout state across edits.
 */
function definition(input: Record<string, unknown>, id: string, revision: number) {
  if ('id' in input || 'revision' in input)
    throw new HttpError(400, 'Put id and expectedRevision beside dashboard, not inside it')
  const tiles = Array.isArray(input.tiles)
    ? input.tiles.map((tile: unknown) =>
        tile && typeof tile === 'object' && !('id' in tile) ? { id: randomUUID(), ...tile } : tile,
      )
    : input.tiles
  return decode(dashboardSchema, { ...input, id, revision, tiles })
}

/**
 * Agent dashboard authoring changes saved definitions only. It never reads tile data, runs a
 * command, opens a terminal or connects to a URL. People start those from Studio, and each run
 * names the revision they saw, so an agent edit cannot change what a pending run starts.
 */
export function agentDashboardCommand(dashboards: Dashboards, command: unknown) {
  const action = agentDashboardAction(command)
  if (action === 'list') {
    decode(commands.list, command)
    return {
      dashboards: dashboards.list().map((entry) => ({
        id: entry.id,
        title: entry.title,
        revision: entry.revision,
        tiles: entry.tiles.length,
      })),
    }
  }
  if (action === 'read') {
    const { id } = decode(commands.read, command)
    const dashboard = dashboards.get(id)
    if (!dashboard) throw new HttpError(404, 'Dashboard not found')
    return { dashboard }
  }
  if (action === 'create') {
    const input = decode(commands.create, command)
    const save = () => dashboards.save(definition(input.dashboard, randomUUID(), 0), 0)
    return {
      dashboard: input.requestId
        ? dashboards.saveOnce(`agent:${input.requestId}`, input, save)
        : save(),
    }
  }
  if (action === 'update') {
    const input = decode(commands.update, command)
    const save = () => {
      if (!dashboards.get(input.id)) throw new HttpError(404, 'Dashboard not found')
      return dashboards.save(
        definition(input.dashboard, input.id, input.expectedRevision),
        input.expectedRevision,
      )
    }
    return {
      dashboard: input.requestId
        ? dashboards.saveOnce(`agent:${input.requestId}`, input, save)
        : save(),
    }
  }
  const input = decode(commands.delete, command)
  if (!dashboards.get(input.id)) throw new HttpError(404, 'Dashboard not found')
  dashboards.delete(input.id, input.expectedRevision)
  return { ok: true as const }
}
