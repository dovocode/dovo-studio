// Only catalog mobile/desktop update screens resolve this boundary. Production
// keeps the protocol release loader; catalog checks never contact GitHub.
export type { RuntimeRelease } from '@dovo/protocol'
import type { RuntimeReleases } from '@dovo/protocol'

export async function fetchRuntimeReleases(): Promise<RuntimeReleases> {
  return {
    stable: {
      version: '0.0.9',
      notes: 'Synthetic catalog release. Your paired computers and settings are preserved.',
      url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9',
    },
  }
}
