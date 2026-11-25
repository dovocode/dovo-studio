import { Schema } from 'effect'
import {
  botPaused,
  effectivePermissionPolicy,
  harnessPluginCommandSchema,
  harnessPluginHarnessNames,
  mutableStruct,
  type HarnessPluginCommand,
} from '@dovo/protocol'
import type { RunPolicy } from '../../auth/run-credentials.js'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'

export const botPluginToolSchema = mutableStruct({
  action: Schema.Literal('plugins'),
  plugins: Schema.optional(harnessPluginCommandSchema),
})

export async function botPluginCommand(
  services: Services,
  run: RunPolicy,
  command: HarnessPluginCommand | undefined,
  signal: AbortSignal,
  authorizeRun: () => void,
) {
  const task = services.store.taskSummary(run.taskId)
  if (!task.bot) throw new HttpError(403, 'Plugin marketplace tools are available in Bot threads.')
  if (!command)
    return {
      list: { action: 'list' },
      catalog: { action: 'catalog', marketplaceId: '<id from list>' },
      preview: { action: 'preview', marketplaceId: '<id>', plugin: '<name from catalog>' },
      install: {
        action: 'install',
        marketplaceId: '<id>',
        plugin: '<plugin name from preview>',
        revision: '<revision from preview>',
        harness: 'claude or codex',
        enabled: false,
      },
      approval: 'Install waits for a person. Use a marketplace already added in Studio.',
    }
  if (command.action === 'list' || command.action === 'catalog' || command.action === 'preview')
    return services.harnessPlugins.command(command)
  if (command.action !== 'install' || command.enabled)
    throw new HttpError(403, 'Bots can install plugins without activating them.')

  const authorizeInstall = () => {
    signal.throwIfAborted()
    authorizeRun()
    const current = services.store.taskSummary(run.taskId)
    if (
      run.readOnly ||
      effectivePermissionPolicy(run.permissions).readOnly ||
      !current.bot ||
      botPaused(current) ||
      current.activeRunId !== run.runId
    )
      throw new HttpError(403, 'Plugin installation requires an active, writable Bot turn.')
  }
  authorizeInstall()
  const preview = await services.harnessPlugins.preview(command.marketplaceId, command.plugin)
  if (preview.revision !== command.revision)
    throw new HttpError(409, 'The marketplace changed. Read the plugin preview again.')
  authorizeInstall()
  const decision = await services.approvals.request(
    task.id,
    `Install ${harnessPluginHarnessNames[command.harness]} plugin ${preview.plugin.name}`,
    JSON.stringify(
      {
        repository: preview.repository,
        folder: preview.plugin.path,
        revision: preview.revision,
        harness: harnessPluginHarnessNames[command.harness],
        activation: 'Off',
        components: preview.components,
      },
      null,
      2,
    ),
    signal,
  )
  if (decision === 'deny') throw new HttpError(403, 'Plugin installation declined or cancelled.')
  return services.harnessPlugins.command(command, authorizeInstall)
}
