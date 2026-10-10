import type { ForgeIssue, ForgePipeline } from '@dovo/protocol'

export function startsStatusGroup(
  row: ForgeIssue | ForgePipeline,
  previous?: ForgeIssue | ForgePipeline,
) {
  return 'state' in row && (!previous || !('state' in previous) || previous.state !== row.state)
}
