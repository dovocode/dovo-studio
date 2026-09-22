import { openDatabase } from './storage/database.js'
import { createServices, type Services } from './services.js'
import { createRuntimeServer } from './http/server.js'
export { backupRuntimeDatabase } from './storage/backup.js'
export { checkAdapterUpdates, type AdapterDiagnostic } from './agents/diagnostics.js'
export async function startRuntime(options: {
  databasePath: string
  ownerToken: string
  host?: string
  port?: number
}): Promise<{ services: Services; port: number; close: () => Promise<void> }> {
  const db = openDatabase(options.databasePath),
    services = createServices(db, options.ownerToken),
    http = createRuntimeServer(services)
  try {
    await new Promise<void>((resolve, reject) => {
      http.server.once('error', reject)
      http.server.listen(options.port ?? 8787, options.host ?? '127.0.0.1', () => {
        http.server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    http.closeSockets()
    services.terminals.dispose()
    services.approvals.dispose()
    services.questions.dispose()
    await services.browsers.dispose()
    await services.simulators.dispose()
    await services.attachments.dispose()
    await services.titles.dispose()
    await services.agents.dispose()
    db.close()
    throw error
  }
  services.liveActivities.start()
  services.jobs.startScheduler()
  services.pullCache.start()
  const address = http.server.address()
  if (!address || typeof address === 'string') throw new Error('Runtime failed to listen')
  return {
    services,
    port: address.port,
    async close() {
      const closed = http.close()
      await services.jobs.shutdown()
      await closed
      await services.pullCache.dispose()
      services.approvals.dispose()
      services.questions.dispose()
      services.terminals.dispose()
      await services.browsers.dispose()
      await services.simulators.dispose()
      await services.tasks.dispose()
      await services.liveActivities.flush()
      await services.liveActivities.dispose()
      await services.attachments.dispose()
      await services.titles.dispose()
      await services.agents.dispose()
      db.close()
    },
  }
}
