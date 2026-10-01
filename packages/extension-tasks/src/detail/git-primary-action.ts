import type { Schema } from 'effect'
import type { responses } from '@dovo/studio-core'

export function gitPrimaryAction(
  state: Schema.Schema.Type<typeof responses.gitActionState> | null,
  hasPull: boolean,
) {
  if (state?.dirty) return state.canPush && !state.behind ? 'Commit & push' : 'Commit'
  if (state?.canPush && !state.behind && (state.ahead > 0 || !state.tracking)) return 'Push branch'
  return hasPull ? 'Open PR' : 'Git actions'
}
