import { Schema } from 'effect'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { mutableArray, mutableStruct, strictStruct, minValue, maxValue } from '../shared/schema.js'

const text = (limit: number) => maxValue(minValue(Schema.String, 1), limit)
const index = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
export const reviewGuideAnchorSchema = strictStruct({
  path: text(4000),
  side: Schema.Literals(['before', 'after']),
  start: index.pipe(Schema.check(Schema.isGreaterThan(0))),
  end: index.pipe(Schema.check(Schema.isGreaterThan(0))),
})
export const reviewGuideSchema = mutableStruct({
  id: text(100),
  revision: text(100),
  generatedAt: text(100),
  steps: maxValue(
    minValue(
      mutableArray(
        mutableStruct({
          title: text(200),
          summary: text(2000),
          impact: text(2000),
          paths: maxValue(minValue(mutableArray(text(4000)), 1), 500),
          excerpts: maxValue(
            mutableArray(
              mutableStruct({
                path: text(4000),
                side: Schema.Literals(['before', 'after']),
                start: index,
                end: index,
                text: maxValue(Schema.String, 16000),
              }),
            ),
            8,
          ),
          questions: maxValue(mutableArray(text(500)), 5),
        }),
      ),
      1,
    ),
    100,
  ),
  position: index,
  seen: maxValue(mutableArray(index), 100),
  version: index,
})
export type ReviewGuide = typeof reviewGuideSchema.Type
/** The mutable part of a guide. Steps never change after generation, so a client that already
 * holds a guide receives only this. */
export const reviewGuideStateSchema = mutableStruct({
  id: text(100),
  revision: text(100),
  position: index,
  seen: maxValue(mutableArray(index), 100),
  version: index,
})
export type ReviewGuideState = typeof reviewGuideStateSchema.Type
export const reviewGuideState = ({ id, revision, position, seen, version }: ReviewGuide) => ({
  id,
  revision,
  position,
  seen,
  version,
})
/** Feature groups follow the guide's steps. Responses carrying a guide omit them. */
export const reviewGuideGroups = (guide: Pick<ReviewGuide, 'steps'>) =>
  guide.steps.map((step) => ({
    label: step.title,
    paths: step.paths,
    summary: step.summary,
    impact: step.impact,
    basis: 'feature' as const,
  }))
export type ReviewGuideAnchor = typeof reviewGuideAnchorSchema.Type
/** The guide a client already holds. Only runtimes that sent a guide receive this field. */
export const knownReviewGuideSchema = Schema.optional(text(100))
export const reviewGuideMoveSchema = strictStruct({
  id: text(100),
  version: index,
  position: index,
  reviewed: Schema.optional(index),
})
/** Includes repository/ref identity as well as file evidence; unchanged patches on a new PR head are a new tour. */
export function reviewRevision(
  files: readonly { path: string; fingerprint: string }[],
  identity: string,
) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          identity,
          [...files]
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
            .map(({ path, fingerprint }) => [path, fingerprint]),
        ]),
      ),
    ),
  )
}
