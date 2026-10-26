import { Schema } from 'effect'
import { titleGenerationSettingsSchema } from '../tasks/title-generation.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { mutableArray, mutableStruct, minValue, maxValue, strictStruct } from '../shared/schema.js'
import type { ChangedFile } from '../workspace.js'
import type { PullDetail } from './pulls/pulls.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const path = maxValue(minValue(Schema.String, 1), 4000)
const integer = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
export const reviewContextSchema = Schema.Union([
  strictStruct({
    kind: Schema.Literal('task'),
    taskId: id,
    source: Schema.Literals(['working', 'branch', 'turn']),
    turnId: Schema.optional(id),
    checkoutId: Schema.optional(id),
  }),
  strictStruct({
    kind: Schema.Literal('pull'),
    repositoryId: id,
    number: integer.pipe(Schema.check(Schema.isGreaterThan(0))),
  }),
])
export type ReviewContext = typeof reviewContextSchema.Type
export const reviewReadSchema = strictStruct({ context: reviewContextSchema })
export const reviewSetSchema = strictStruct({
  context: reviewContextSchema,
  path,
  fingerprint: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  viewed: Schema.Boolean,
  version: integer,
})
export const reviewProgressSchema = mutableStruct({
  files: mutableArray(
    mutableStruct({ path, fingerprint: Schema.String, viewed: Schema.Boolean, version: integer }),
  ),
  groups: mutableArray(
    mutableStruct({
      label: Schema.String,
      paths: mutableArray(Schema.String),
      // Accept legacy runtime responses; clients only apply feature grouping.
      basis: Schema.Literals(['ast', 'folder', 'feature']),
      summary: Schema.optional(maxValue(Schema.String, 2000)),
      impact: Schema.optional(maxValue(Schema.String, 2000)),
    }),
  ),
})
export type ReviewProgress = typeof reviewProgressSchema.Type
export type ReviewGroup = ReviewProgress['groups'][number]

export const reviewOrganizeSchema = strictStruct({
  context: reviewContextSchema,
  selection: Schema.optional(titleGenerationSettingsSchema),
  files: maxValue(mutableArray(strictStruct({ path, fingerprint: Schema.String })), 500),
})
export const featureReviewSchema = strictStruct({
  groups: maxValue(
    minValue(
      mutableArray(
        strictStruct({
          label: maxValue(minValue(Schema.String, 1), 200),
          summary: maxValue(minValue(Schema.String, 1), 2000),
          impact: maxValue(minValue(Schema.String, 1), 2000),
          paths: maxValue(minValue(mutableArray(path), 1), 500),
        }),
      ),
      1,
    ),
    100,
  ),
})
/** Model output must partition the supplied changed files, without inventing paths. */
export function featureReviewGroups(
  value: typeof featureReviewSchema.Type,
  paths: string[],
): ReviewGroup[] {
  const remaining = new Set(paths)
  const groups = value.groups.map((group) => {
    for (const path of group.paths) {
      if (!remaining.delete(path))
        throw new Error('The organizer returned an unknown or duplicate file. Try again.')
    }
    return { ...group, basis: 'feature' as const }
  })
  if (remaining.size) throw new Error('The organizer omitted changed files. Try again.')
  return groups
}

export function filePreviewIdentity(preview: ChangedFile['preview']) {
  return JSON.stringify(
    preview
      ? [
          preview.kind,
          ...[preview.before, preview.after].map((side) =>
            side ? [side.hash, side.size, side.mode] : null,
          ),
        ]
      : null,
  )
}
export function changedFileFingerprint(file: ChangedFile) {
  const hash = sha256.create()
  // Separate fields unambiguously, without allocating another copy of the entire diff.
  for (const field of [file.path, file.before, file.after, filePreviewIdentity(file.preview)]) {
    hash.update(new TextEncoder().encode(`${field.length}:`))
    hash.update(new TextEncoder().encode(field))
  }
  return bytesToHex(hash.digest())
}
export function pullFileFingerprint(
  file: PullDetail['files'][number],
  pull: Pick<PullDetail['pull'], 'baseSha' | 'headSha'>,
) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          file.path,
          file.previousPath ?? null,
          file.status,
          file.additions,
          file.deletions,
          file.patch ?? null,
          file.patch ? null : [pull.baseSha, pull.headSha],
        ]),
      ),
    ),
  )
}
/** Never display a mark for a different revision of the visible diff. */
export function reviewFileState(
  progress: ReviewProgress | null,
  path: string,
  fingerprint: string,
) {
  return progress?.files.find((file) => file.path === path && file.fingerprint === fingerprint)
}
export function orderReviewFiles<T extends { path: string }>(
  files: T[],
  groups: ReviewGroup[],
  related: boolean,
) {
  if (!related) return [...files].sort((a, b) => a.path.localeCompare(b.path))
  const rank = new Map(
    groups
      .filter((group) => group.basis === 'feature')
      .flatMap((group) => group.paths)
      .map((path, index) => [path, index]),
  )
  return [...files].sort(
    (a, b) =>
      (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity) ||
      a.path.localeCompare(b.path),
  )
}

/** Viewer-owned index: build once per immutable file list, then keep revision checks constant time. */
export function createReviewFileLookup(progress: ReviewProgress | null) {
  const paths = new Map<string, Map<string, ReviewProgress['files'][number]>>()
  for (const file of progress?.files ?? []) {
    let revisions = paths.get(file.path)
    if (!revisions) {
      revisions = new Map()
      paths.set(file.path, revisions)
    }
    // Preserve the existing first-match behavior, including historical duplicate revisions.
    if (!revisions.has(file.fingerprint)) revisions.set(file.fingerprint, file)
  }
  return (path: string, fingerprint: string) => paths.get(path)?.get(fingerprint)
}
/** Index both sides of a rename without changing comment order or duplicating same-path aliases. */
export function pullCommentsByFile(files: PullDetail['files'], comments: PullDetail['comments']) {
  const aliases = new Map<string, Set<string>>()
  for (const file of files)
    for (const path of [file.path, file.previousPath]) {
      if (!path) continue
      const paths = aliases.get(path) ?? new Set<string>()
      paths.add(file.path)
      aliases.set(path, paths)
    }
  const result = new Map<string, PullDetail['comments']>()
  for (const comment of comments) {
    if (comment.kind !== 'inline' || !comment.path) continue
    for (const path of aliases.get(comment.path) ?? []) {
      const rows = result.get(path) ?? []
      rows.push(comment)
      result.set(path, rows)
    }
  }
  return result
}
