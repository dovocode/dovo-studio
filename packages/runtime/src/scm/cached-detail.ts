import type { PullDetail } from '@dovo/protocol'
export function retainUnavailableSections(fresh: PullDetail, cached?: PullDetail): PullDetail {
  if (!cached) return fresh
  const failed = (section: string) => fresh.warnings.some((w) => w.startsWith(section + ':'))
  const missingKinds = new Set<string>(
    [
      ['Conversation', 'comment'],
      ['Reviews', 'review'],
      ['Inline comments', 'inline'],
    ]
      .filter(([section]) => failed(section))
      .map(([, kind]) => kind),
  )
  const sameHead = fresh.pull.headSha === cached.pull.headSha
  const files = failed('Files') && sameHead && fresh.pull.baseSha === cached.pull.baseSha,
    checks = failed('Checks') && sameHead
  return {
    ...fresh,
    comments: [...fresh.comments, ...cached.comments.filter((c) => missingKinds.has(c.kind))].sort(
      (a, b) => a.date.localeCompare(b.date),
    ),
    files: files ? cached.files : fresh.files,
    checks: checks ? cached.checks : fresh.checks,
    warnings: [
      ...fresh.warnings,
      ...(missingKinds.size || files || checks
        ? ['Unavailable sections are showing the last cached data.']
        : []),
    ],
  }
}
