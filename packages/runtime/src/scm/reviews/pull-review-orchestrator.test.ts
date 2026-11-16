import { expect, it } from 'vite-plus/test'
import { orchestratePullReview } from './pull-review-orchestrator.js'
import type { PullReviewProgress } from './pull-review-engine.js'

function report(): PullReviewProgress {
  const common = {
    path: 'src/draft.ts',
    side: 'after' as const,
    line: 4,
    severity: 'high' as const,
    title: 'Draft cleared before save',
    trigger: 'Save fails',
    impact: 'Draft is lost',
    suggestion: 'Keep the draft',
    evidence: 'clearDraft()',
    anchored: true,
  }
  return {
    summary: 'Individual results',
    coverage: [],
    notVerified: [],
    findings: [
      { ...common, id: 'a', reviewerIds: ['reviewer-1'] },
      { ...common, id: 'b', title: 'A failed save drops the draft', reviewerIds: ['reviewer-2'] },
    ],
    analysis: {
      batches: 2,
      completedBatches: 2,
      phase: 'combining',
      rejectedFindings: 0,
      contextFiles: [],
    },
  }
}

it('groups semantically overlapping reports while retaining an original anchor and all reviewer attribution', async () => {
  const original = report()
  const result = await orchestratePullReview(
    original,
    async () =>
      JSON.stringify({
        summary: 'One draft-loss defect.',
        groups: [{ ids: ['a', 'b'], representative: 'b' }],
      }),
    new AbortController().signal,
  )
  expect(result.findings).toEqual([
    { ...original.findings[1], reviewerIds: ['reviewer-1', 'reviewer-2'] },
  ])
  expect(result.summary).toBe('One draft-loss defect.')
  expect(original.findings).toHaveLength(2)
})
it.each([
  [{ ids: ['a'], representative: 'a' }],
  [{ ids: ['a', 'a', 'b'], representative: 'a' }],
  [{ ids: ['a', 'b', 'invented'], representative: 'a' }],
  [{ ids: ['a', 'b'], representative: 'invented' }],
])(
  'keeps the original findings when a combining pass loses or invents evidence: %j',
  async (groups) => {
    const original = report()
    const result = await orchestratePullReview(
      original,
      async () => JSON.stringify({ summary: 'Invalid grouping', groups }),
      new AbortController().signal,
    )
    expect(result.findings).toEqual(original.findings)
    expect(result.summary).toBe(original.summary)
    expect(result.notVerified.join('\n')).toContain('Individual findings were kept')
  },
)
it('keeps unrelated files separate and preserves results if the orchestrator is unavailable', async () => {
  const original = report()
  original.findings[1].path = 'src/other.ts'
  for (const call of [
    async () =>
      JSON.stringify({
        summary: 'Bad grouping',
        groups: [{ ids: ['a', 'b'], representative: 'a' }],
      }),
    async () => {
      throw new Error('Provider unavailable')
    },
  ]) {
    const result = await orchestratePullReview(original, call, new AbortController().signal)
    expect(result.findings).toEqual(original.findings)
    expect(result.notVerified.join('\n')).toContain('Individual findings were kept')
  }
})
it('propagates cancellation instead of marking the combining phase successful', async () => {
  const controller = new AbortController()
  await expect(
    orchestratePullReview(
      report(),
      async () => {
        controller.abort(new Error('Stopped'))
        return '{}'
      },
      controller.signal,
    ),
  ).rejects.toThrow('Stopped')
})
