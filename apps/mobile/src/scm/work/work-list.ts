import type { ForgeIssue, ForgePipeline } from '@dovo/protocol'

/** A PR's runs must match its head commit, never a title, ref or partial hash. */
export function matchesPipelineCommit(row: ForgeIssue | ForgePipeline, sha: string | undefined) {
  return !!sha && 'sha' in row && row.sha.toLowerCase() === sha.toLowerCase()
}
