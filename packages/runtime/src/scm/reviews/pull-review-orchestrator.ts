import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  maxValue,
  minValue,
  type PullCodeReview,
} from '@dovo/protocol'
import { errorMessage } from '../../errors.js'
import type { PullReviewProgress } from './pull-review-engine.js'

const schema = mutableStruct({
  summary: maxValue(minValue(Schema.String, 1), 4000),
  groups: mutableArray(
    mutableStruct({
      ids: mutableArray(Schema.String),
      representative: Schema.String,
    }),
  ),
})

/** A model may group existing findings. It cannot create evidence or silently drop findings. */
export async function orchestratePullReview<T extends PullReviewProgress>(
  result: T,
  call: (text: string) => Promise<string>,
  signal: AbortSignal,
): Promise<T> {
  if (!result.findings.length) return result
  try {
    const input = JSON.stringify({
      findings: result.findings,
      limits: result.notVerified,
      coverage: {
        supplied: result.coverage.filter((file) => file.state === 'supplied').length,
        total: result.coverage.length,
      },
    })
    if (input.length > 240_000)
      throw new Error('Combined findings exceed the orchestrator input limit.')
    const value = await call(input)
    signal.throwIfAborted()
    const combined = decode(
      schema,
      JSON.parse(
        value
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, ''),
      ),
    )
    const byId = new Map(result.findings.map((finding) => [finding.id, finding]))
    const seen = new Set<string>()
    const findings: PullCodeReview['findings'] = combined.groups.map((group) => {
      if (!group.ids.length || !group.ids.includes(group.representative))
        throw new Error('The orchestrator returned an invalid representative.')
      const items = group.ids.map((id) => {
        const finding = byId.get(id)
        if (!finding || seen.has(id))
          throw new Error('The orchestrator repeated or invented a finding.')
        seen.add(id)
        return finding
      })
      const representative = items.find((finding) => finding.id === group.representative)
      if (!representative) throw new Error('The orchestrator representative is unavailable.')
      if (
        items.some(
          (finding) => finding.path !== representative.path || finding.side !== representative.side,
        )
      )
        throw new Error('The orchestrator combined findings from different files or patch sides.')
      return {
        ...representative,
        reviewerIds: [...new Set(items.flatMap((finding) => finding.reviewerIds ?? []))],
      }
    })
    if (seen.size !== byId.size) throw new Error('The orchestrator omitted a finding.')
    const severity = { high: 0, medium: 1, low: 2 }
    findings.sort(
      (a, b) =>
        severity[a.severity] - severity[b.severity] || (b.confidence ?? 0) - (a.confidence ?? 0),
    )
    return {
      ...result,
      findings,
      summary: combined.summary,
      notVerified: [
        ...result.notVerified,
        'The primary reviewer combined overlapping findings. Model agreement and grouping do not prove correctness.',
      ],
    }
  } catch (error) {
    signal.throwIfAborted()
    return {
      ...result,
      notVerified: [
        ...result.notVerified,
        `Combining reviewer findings did not finish. Individual findings were kept: ${errorMessage(error)}`,
      ],
    }
  }
}
