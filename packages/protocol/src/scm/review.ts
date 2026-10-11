import { Schema } from 'effect'
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
      basis: Schema.Literals(['ast', 'folder']),
    }),
  ),
})
export type ReviewProgress = typeof reviewProgressSchema.Type
export type ReviewGroup = ReviewProgress['groups'][number]

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
  const rank = new Map(groups.flatMap((group) => group.paths).map((path, index) => [path, index]))
  return [...files].sort(
    (a, b) =>
      (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity) ||
      a.path.localeCompare(b.path),
  )
}
