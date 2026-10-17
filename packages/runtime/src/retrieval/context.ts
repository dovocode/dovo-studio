import { AsyncLocalStorage } from 'node:async_hooks'
import type { RetrievalRequest } from './request.js'

const context = new AsyncLocalStorage<{ local?: boolean; fresh?: boolean; watch?: boolean }>()
export const retrievalLocal = <T>(run: () => T) =>
  context.run({ ...context.getStore(), local: true }, run)
export const retrievalFresh = <T>(fresh: boolean, run: () => T) =>
  context.run({ ...context.getStore(), fresh: context.getStore()?.watch ? false : fresh }, run)
export const retrievalWatching = <T>(run: () => T, enabled = true) =>
  enabled ? context.run({ ...context.getStore(), fresh: false, watch: true }, run) : run()
export const retrievalContext = () => context.getStore()
export type RetrievalHook = {
  active: () => boolean
  read: (request: RetrievalRequest, load: () => Promise<string>) => Promise<string>
  invalidate: (provider: 'github' | 'jira', instance: string, reader: string) => Promise<void>
}
