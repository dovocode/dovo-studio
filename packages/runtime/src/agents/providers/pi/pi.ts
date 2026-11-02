import type { AgentAdapter } from '../../execution/types.js'
import { runPiSession } from './pi-run.js'
import { requirePiVersion } from './pi-version.js'

export function createPiAdapter(): AgentAdapter {
  return {
    async probe(agent) {
      try {
        await requirePiVersion(agent)
        return {
          provider: 'pi',
          available: true,
          detail:
            'Pi imported sessions support built-in tools only with full access; otherwise they are text-only.',
        }
      } catch (error) {
        return {
          provider: 'pi',
          available: false,
          detail:
            error instanceof Error
              ? error.message
              : 'Pi executable is not available on this runtime.',
        }
      }
    },
    run: runPiSession,
  }
}
