import type { Schema } from 'effect'
import type { responses } from '../runtime/connection/runtime.js'

export function gitPrimaryAction(
  state: Schema.Schema.Type<typeof responses.gitActionState> | null,
  hasPull: boolean,
) {
  if (state?.dirty) return state.canPush && !state.behind ? 'Commit & push' : 'Commit'
  if (state?.canPush && !state.behind && (state.ahead > 0 || !state.tracking)) return 'Push branch'
  if (hasPull) return 'Open PR'
  return !state || (state.canPush && !state.behind) ? 'Commit & push' : 'Commit'
}
