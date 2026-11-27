import type { IncomingMessage } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import { Effect } from 'effect'
import {
  decode,
  needsStudioDataSources,
  SCRATCH_PROJECT_ID,
  dashboardDeleteRequestSchema,
  dashboardListRequestSchema,
  dashboardReadRequestSchema,
  dashboardRunRequestSchema,
  dashboardRunResultSchema,
  dashboardSessionResultSchema,
  dashboardSaveRequestSchema,
  type Dashboard,
  type DashboardTile,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import type { Services } from '../../services.js'
import { HttpError, errorMessage, runtimeOperation } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { commandCheckLaunch, resolveTerminalShell } from '../../terminal/shell.js'
import { workspaceTerminalCheckout } from '../../terminal/workspace-checkout.js'

/** A save carries at most 32 tiles of 4 KiB fields and a 20 KB command each. */
const SAVE_BODY_LIMIT = 1024 * 1024

/**
 * Starts the saved command of a command or TUI tile in a new standalone terminal. A command tile
 * uses a noninteractive shell, so `/api/terminals/summary` reports the command's exit code. A
 * TUI tile types the command into an interactive shell, which stays open after the program ends.
 */
async function launchTile(
  s: Services,
  token: string,
  dashboard: Dashboard,
  tile: Extract<DashboardTile, { kind: 'command' | 'tui' }>,
  beginLaunch: () => void,
) {
  // An empty ID would fall back to the home folder. No Project uses SCRATCH_PROJECT_ID instead.
  // Template drafts clear the project, and saves reject that, but older rows may still hold it.
  if (!tile.repositoryId.trim())
    throw new HttpError(400, `${tile.title}: choose a project or the home folder. Nothing ran.`, {
      mutationRejected: true,
    })
  const repository =
    tile.repositoryId === SCRATCH_PROJECT_ID
      ? undefined
      : s.store.get().repositories.find((entry) => entry.id === tile.repositoryId)
  const authorize = () => {
    s.devices.authenticate(token)
    if (s.dashboards.get(dashboard.id)?.revision !== dashboard.revision)
      throw new HttpError(409, 'This dashboard changed. Reload it before you run the command.')
    if (
      repository &&
      !isDeepStrictEqual(
        repository,
        s.store.get().repositories.find((entry) => entry.id === tile.repositoryId),
      )
    )
      throw new HttpError(409, 'The project changed. Reload the dashboard and try again.')
  }
  authorize()
  const shell = tile.kind === 'tui' ? await resolveTerminalShell(s.commands.get()) : undefined
  const launch = shell ?? commandCheckLaunch(tile.command)
  authorize()
  s.terminals.checkCapacity()
  // The main checkout only: a dashboard never creates a worktree.
  const checkout = await workspaceTerminalCheckout(
    s,
    { repositoryId: tile.repositoryId, execution: 'main' },
    authorize,
    beginLaunch,
  )
  authorize()
  const info = await s.terminals.createWorkspaceCommand(
    checkout.directory,
    launch,
    tile.title,
    checkout.repositoryId,
    {
      ...checkout,
      shellId: shell?.id,
      // The last check runs right before the process starts. Revoking the device, editing or
      // deleting the dashboard, withdrawing the approval or changing the project stops it.
      beforeSpawn: () => {
        authorize()
        beginLaunch()
      },
      initialInput: tile.kind === 'tui' ? `${tile.command.replace(/\r?\n/g, '\r')}\r` : undefined,
    },
  )
  return { terminalId: info.id }
}

/** Paired human clients only. Agents and run credentials cannot read or change dashboards. */
export function dashboardsRoute(
  request: IncomingMessage,
  path: string,
  token: string,
  agentAccess: boolean,
) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(404, 'Endpoint not found')
      if (agentAccess) throw new HttpError(403, 'Dashboards require a paired human client')
      const device = s.devices.authenticate(token)
      if (path === '/api/dashboards/list') {
        const input = decode(dashboardListRequestSchema, yield* serviceResult(body(request)))
        s.devices.authenticate(token)
        const dashboards = s.dashboards.list()
        return {
          dashboards: input.dataSources
            ? dashboards
            : dashboards.filter((dashboard) => !needsStudioDataSources(dashboard)),
        }
      }
      if (path === '/api/dashboards/save') {
        const input = decode(
          dashboardSaveRequestSchema,
          yield* serviceResult(body(request, SAVE_BODY_LIMIT)),
        )
        // A slow upload can outlast the device. Check it again before the write.
        s.devices.authenticate(token)
        const save = () => s.dashboards.save(input.dashboard, input.expectedRevision)
        return {
          dashboard: input.requestId
            ? s.dashboards.saveOnce(
                `studio:${input.requestId}`,
                [input.dashboard, input.expectedRevision],
                save,
              )
            : save(),
        }
      }
      if (path === '/api/dashboards/delete') {
        const input = decode(dashboardDeleteRequestSchema, yield* serviceResult(body(request)))
        s.devices.authenticate(token)
        s.dashboards.delete(input.id, input.expectedRevision)
        return { ok: true as const }
      }
      if (path === '/api/dashboards/read' || path === '/api/dashboards/command-data') {
        const input = decode(dashboardReadRequestSchema, yield* serviceResult(body(request)))
        return yield* runtimeOperation(() =>
          s.dashboards.read(
            input.id,
            input.tileId,
            input.expectedRevision,
            () => {
              s.devices.authenticate(token)
            },
            path === '/api/dashboards/command-data',
            input.automatic,
          ),
        )
      }
      if (path === '/api/dashboards/session') {
        // Reattach after navigation or reconnect. Read-only: it never starts a terminal.
        const input = decode(dashboardReadRequestSchema, yield* serviceResult(body(request)))
        s.devices.authenticate(token)
        const { tile } = s.dashboards.current(input.id, input.tileId, input.expectedRevision)
        if (tile.kind !== 'command' && tile.kind !== 'tui')
          throw new HttpError(400, 'Only command and TUI tiles have sessions')
        const terminalId = s.dashboards.session(input.id, tile)
        const open = terminalId && s.terminals.list().some((entry) => entry.id === terminalId)
        return decode(dashboardSessionResultSchema, { terminalId: open ? terminalId : null })
      }
      if (path === '/api/dashboards/run') {
        const input = decode(dashboardRunRequestSchema, yield* serviceResult(body(request)))
        // One press of Run starts at most one terminal. A repeat returns the same terminal.
        const receipt = yield* runtimeOperation(() =>
          s.mutations.execute(
            device.id,
            `dashboard-run:${input.requestId}`,
            input,
            async () => {
              let launchStarted = false
              try {
                const { dashboard, tile } = s.dashboards.tile(input.id, input.tileId)
                if (dashboard.revision !== input.expectedRevision)
                  throw new HttpError(
                    409,
                    'This dashboard changed. Reload it before you run the command.',
                  )
                if (tile.kind !== 'command' && tile.kind !== 'tui')
                  throw new HttpError(400, 'Only command and TUI tiles can run')
                const result = await launchTile(s, token, dashboard, tile, () => {
                  launchStarted = true
                })
                s.dashboards.recordSession(dashboard.id, tile, result.terminalId)
                return result
              } catch (error) {
                // Checks before the spawn leave nothing behind, so the same request can retry.
                if (launchStarted) throw error
                throw new HttpError(
                  error instanceof HttpError ? error.status : 409,
                  errorMessage(error),
                  { mutationRejected: true },
                )
              }
            },
            'confirmed-rejection',
          ),
        )
        s.devices.authenticate(token)
        return decode(dashboardRunResultSchema, receipt)
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
