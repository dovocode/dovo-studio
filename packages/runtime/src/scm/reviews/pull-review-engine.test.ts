import { expect, it, vi } from 'vite-plus/test'
import {
  defaultTaskHarness,
  type PullCodeReview,
  type PullDetail,
  type pullCodeReviewOutputSchema,
} from '@dovo/protocol'
import { pullReviewPlan, runPullReview, type PullReviewProgress } from './pull-review-engine.js'

type Call = Parameters<typeof runPullReview>[0]['call']
type ReadSnapshot = NonNullable<Parameters<typeof runPullReview>[0]['readSnapshot']>
type Candidate = (typeof pullCodeReviewOutputSchema.Type.findings)[number]
const patch = '@@ -1 +1 @@\n-original\n+changed\n'
const file = (path: string, text = patch): PullDetail['files'][number] => ({
  path,
  patch: text,
  status: 'modified',
  additions: 1,
  deletions: 1,
})
function detail(files: PullDetail['files']): PullDetail {
  return {
    pull: {
      number: 42,
      title: 'Keep drafts',
      body: 'Restore safely',
      url: 'https://github.com/acme/repo/pull/42',
      repositoryUrl: 'https://github.com/acme/repo',
      state: 'open',
      draft: false,
      author: 'author',
      updatedAt: '',
      head: 'feature',
      base: 'main',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      additions: 1,
      deletions: 1,
      changedFiles: files.length,
      mergeable: true,
      labels: [],
      reviewers: [],
      assignees: [],
    },
    files,
    comments: [],
    checks: [],
    warnings: [],
  }
}
function report(
  coverage: PullCodeReview['coverage'] = [{ path: 'a.ts', patch, state: 'supplied', batch: 0 }],
): PullCodeReview {
  return {
    id: 'review',
    requestId: 'request',
    revision: 'revision',
    version: 0,
    sequence: 0,
    url: 'https://github.com/acme/repo/pull/42',
    destination: 'destination',
    readerIdentity: 'reader',
    account: 'dominic',
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
    selection: {
      harness: defaultTaskHarness('claude'),
      agentId: '',
      model: 'review-model',
      reasoning: '',
    },
    createdAt: '',
    status: 'running',
    summary: '',
    notVerified: [],
    coverage,
    missingFiles: 0,
    findings: [],
    draft: { body: '', selected: [], dismissed: [], event: 'comment' },
  }
}
const candidate: Candidate = {
  path: 'a.ts',
  side: 'after',
  line: 1,
  severity: 'high',
  title: 'Lost value',
  trigger: 'Read a saved value',
  impact: 'The value is lost',
  suggestion: 'Keep the value',
  evidence: 'changed',
  confidence: 9,
}
const output = (findings: Candidate[]) =>
  JSON.stringify({ summary: 'Review summary', findings, notVerified: [] })
const keep = (id: string, extra = {}) => ({
  id,
  verdict: 'keep',
  confidence: 9,
  reason: 'The supplied code supports the trigger.',
  ...extra,
})
function run(options: Partial<Parameters<typeof runPullReview>[0]> = {}) {
  return runPullReview({
    review: report(),
    intent: { title: 'Keep drafts', body: 'Restore safely' },
    signal: new AbortController().signal,
    progress: () => {},
    call: async (_, phase) =>
      phase === 'review' ? output([candidate]) : JSON.stringify({ decisions: [keep('0')] }),
    ...options,
  })
}

it('packs whole serialized patches into at most four batches and exposes all omissions', () => {
  const plan = pullReviewPlan(
    detail([
      ...Array.from({ length: 6 }, (_, i) => file(`${i}.ts`)),
      file('large.ts', '@@ -1 +1 @@\n-x\n+' + 'x'.repeat(400) + '\n'),
      file('partial.ts', '@@ -1,3 +1,3 @@\n-x\n+y\n'),
      file('not-a-patch.ts', 'diff unavailable'),
      { ...file('generated.ts'), attributes: { binary: false, generated: true, vendored: false } },
      { ...file('missing.ts'), patch: undefined },
      file('previous.ts'),
    ]),
    new Set(['previous.ts']),
    200,
  )
  expect(plan.coverage.slice(0, 6).map((f) => [f.state, f.batch])).toEqual([
    ['supplied', 0],
    ['supplied', 1],
    ['supplied', 2],
    ['supplied', 3],
    ['budget', undefined],
    ['budget', undefined],
  ])
  expect(plan.coverage.slice(6).map((f) => f.state)).toEqual([
    'too-large',
    'partial',
    'partial',
    'excluded',
    'unavailable',
    'previous-pass',
  ])
  expect(plan.coverage.filter((f) => f.state !== 'supplied').every((f) => !f.patch)).toBe(true)
})

it('filters unsupported paths, quotes, context-only anchors and low confidence before the challenge', async () => {
  const contextualPatch = '@@ -1,2 +1,2 @@\n-original\n+changed\n context\n'
  const proposed = [
    candidate,
    { ...candidate, path: 'invented.ts' },
    { ...candidate, evidence: 'invented' },
    { ...candidate, confidence: 7 },
    { ...candidate, line: 2, evidence: 'context' },
  ]
  const call = vi.fn<Call>(async (_: string, phase: 'review' | 'check') =>
    phase === 'review' ? output(proposed) : JSON.stringify({ decisions: [keep('0')] }),
  )
  const result = await run({
    review: report([{ path: 'a.ts', patch: contextualPatch, state: 'supplied' }]),
    call,
  })
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0]).toMatchObject({
    anchored: true,
    evidence: 'changed',
    confidence: 9,
    verification: expect.stringContaining('supports'),
  })
  expect(result.analysis.rejectedFindings).toBe(4)
  expect(JSON.parse(call.mock.calls[1][0]).candidates).toHaveLength(1)
})

it('accepts exact deletion evidence and consecutive evidence that includes a changed line', async () => {
  const result = await run({
    review: report([
      {
        path: 'a.ts',
        patch: '@@ -1,2 +1,2 @@\n-original\n+changed\n context\n',
        state: 'supplied',
      },
    ]),
    call: async (_, phase) =>
      phase === 'review'
        ? output([{ ...candidate, side: 'before', evidence: 'original\ncontext' }])
        : JSON.stringify({ decisions: [keep('0')] }),
  })
  expect(result.findings[0]).toMatchObject({ side: 'before', evidence: 'original\ncontext' })
})

it('uses the challenge to reject findings, lowers confidence and removes duplicates', async () => {
  const result = await run({
    call: async (_, phase) =>
      phase === 'review'
        ? output([
            candidate,
            { ...candidate, title: ' lost   value ' },
            { ...candidate, title: 'Speculative impact' },
            { ...candidate, title: 'Minor bug', severity: 'low' },
            { ...candidate, title: 'Weak countercheck' },
          ])
        : JSON.stringify({
            decisions: [
              keep('0', { confidence: 8 }),
              keep('1'),
              keep('2', { verdict: 'reject' }),
              keep('3'),
              keep('4', { confidence: 7 }),
            ],
          }),
  })
  expect(result.findings.map((f) => [f.title, f.confidence])).toEqual([
    ['Lost value', 8],
    ['Minor bug', 9],
  ])
  expect(result.analysis.rejectedFindings).toBe(3)
})

it('does not retain a rejected defect in the narrative summary', async () => {
  const result = await run({
    call: async (_, phase) =>
      phase === 'review'
        ? JSON.stringify({
            summary: 'The PR loses all saved drafts.',
            notVerified: [],
            findings: [candidate],
          })
        : JSON.stringify({ decisions: [keep('0', { verdict: 'reject' })] }),
  })
  expect(result.findings).toEqual([])
  expect(result.summary).toContain('0 supported bug findings')
  expect(result.summary).not.toContain('loses all saved drafts')
})

it('rejects duplicate challenge IDs even when the decision count matches', async () => {
  await expect(
    run({
      call: async (_, phase) =>
        phase === 'review'
          ? output([candidate, { ...candidate, title: 'Another defect' }])
          : JSON.stringify({ decisions: [keep('0'), keep('0')] }),
    }),
  ).rejects.toThrow('every candidate exactly once')
})

it('caps merged reports after sorting without claiming the other findings disappeared', async () => {
  let batch = 0
  const result = await run({
    review: report([
      { path: 'a.ts', patch, state: 'supplied', batch: 0 },
      { path: 'b.ts', patch, state: 'supplied', batch: 1 },
    ]),
    call: async (_, phase) => {
      if (phase === 'check')
        return JSON.stringify({ decisions: Array.from({ length: 100 }, (_, i) => keep(String(i))) })
      const path = batch++ === 0 ? 'a.ts' : 'b.ts'
      return output(
        Array.from({ length: 100 }, (_, i) => ({
          ...candidate,
          path,
          title: `Bug ${i}`,
          severity: path === 'a.ts' ? 'low' : 'high',
        })),
      )
    },
  })
  expect(result.findings).toHaveLength(100)
  expect(result.findings.every((finding) => finding.severity === 'high')).toBe(true)
  expect(result.notVerified.join('\n')).toContain('100 additional findings were omitted')
  expect(result.summary).toContain('100 supported bug findings')
})

it.each([
  { decisions: [] },
  { decisions: [keep('0'), keep('0')] },
  { decisions: [keep('1')] },
  { decisions: [keep('00')] },
  { decisions: [keep('-1')] },
  { decisions: [keep('0', { reason: '' })] },
])(
  'rejects an incomplete or invalid challenge instead of keeping unchecked findings: %j',
  async ({ decisions }) => {
    await expect(
      run({
        call: async (_, phase) =>
          phase === 'review' ? output([candidate]) : JSON.stringify({ decisions }),
      }),
    ).rejects.toThrow(/Batch 1 did not finish/)
  },
)

it('retains a successful batch after another fails, with accurate active progress and coverage', async () => {
  const progress: PullReviewProgress[] = []
  const review = report([
    { path: 'failed.ts', patch, state: 'supplied', batch: 0 },
    { path: 'a.ts', patch, state: 'supplied', batch: 1 },
  ])
  let mainCalls = 0
  const result = await run({
    review,
    progress: (p) => progress.push(p),
    call: async (_, phase) => {
      if (phase === 'check') return JSON.stringify({ decisions: [keep('0')] })
      if (mainCalls++ === 0) throw new Error('Model unavailable')
      return output([candidate])
    },
  })
  expect(result.coverage.map((f) => f.state)).toEqual(['failed', 'supplied'])
  expect(result.findings).toHaveLength(1)
  expect(result.analysis).toMatchObject({ batches: 2, completedBatches: 1, phase: 'completed' })
  expect(result.analysis.activeBatch).toBeUndefined()
  expect(result.notVerified.join('\n')).toContain('Batch 1 did not finish: Model unavailable')
  expect(
    progress.some((p) => p.analysis.activeBatch === 2 && p.analysis.completedBatches === 0),
  ).toBe(true)
  expect(progress[0].coverage.map((f) => f.state)).toEqual(['queued', 'queued'])
  expect(review.coverage.every((f) => f.state === 'supplied')).toBe(true)
})

it('stops on cancellation without starting the challenge or another batch', async () => {
  const controller = new AbortController()
  const call = vi.fn<Call>(async () => {
    controller.abort(new Error('Stop review'))
    return output([candidate])
  })
  await expect(
    run({
      signal: controller.signal,
      call,
      review: report([
        { path: 'a.ts', patch, state: 'supplied', batch: 0 },
        { path: 'b.ts', patch, state: 'supplied', batch: 1 },
      ]),
    }),
  ).rejects.toThrow('Stop review')
  expect(call).toHaveBeenCalledTimes(1)
})

it('supplies immutable changed files and bounded relative imports, with base fallback for deletions', async () => {
  const review = report([
    { path: 'src/a.ts', patch, state: 'supplied' },
    { path: 'deleted.ts', patch, state: 'supplied' },
  ])
  const readSnapshot = vi.fn<ReadSnapshot>(async (path: string, ref: string) => {
    if (path === 'src/a.ts')
      return "import {x} from './dep.js'\nimport '../outside/../../escape'\n" + ' '.repeat(40)
    if (path === 'src/dep.ts') return 'export const x = 1'
    if (path === 'deleted.ts' && ref === review.baseSha) return 'const removed = true'
    return undefined
  })
  const call = vi.fn<Call>(async (_input: string) => output([]))
  const result = await run({ review, readSnapshot, call })
  expect(result.analysis.contextFiles).toEqual([
    { path: 'src/a.ts', ref: review.headSha, text: expect.stringContaining('./dep.js') },
    { path: 'deleted.ts', ref: review.baseSha, text: 'const removed = true' },
    { path: 'src/dep.ts', ref: review.headSha, text: 'export const x = 1' },
  ])
  expect(
    readSnapshot.mock.calls.every(
      ([path, ref]) => !path.startsWith('../') && [review.headSha, review.baseSha].includes(ref),
    ),
  ).toBe(true)
  const sent = JSON.parse(call.mock.calls[0][0])
  expect(sent.intent).toEqual({ title: 'Keep drafts', body: 'Restore safely' })
  expect(sent.context).toEqual(result.analysis.contextFiles)
})

it('bounds attempted snapshots and serialized context without truncating files', async () => {
  const review = report(
    Array.from({ length: 40 }, (_, i) => ({ path: `${i}.ts`, patch, state: 'supplied' })),
  )
  const readSnapshot = vi.fn<ReadSnapshot>(async () => '\n'.repeat(15_000))
  const result = await run({ review, readSnapshot, call: async () => output([]) })
  expect(readSnapshot).toHaveBeenCalledTimes(32)
  expect(result.analysis.contextFiles).toHaveLength(1)
  expect(result.analysis.contextFiles[0].text).toHaveLength(15_000)
})

it('records unavailable snapshot context without failing the patch review', async () => {
  const result = await run({
    readSnapshot: async () => {
      throw new Error('Commit is not available locally')
    },
  })
  expect(result.findings).toHaveLength(1)
  expect(result.analysis.contextFiles).toEqual([])
  expect(result.notVerified.join('\n')).toContain('Commit is not available locally')
})

it('bounds full serialized inputs including expanded line numbers and metadata', async () => {
  const text = '@@ -1,1500 +1,1500 @@\n' + Array.from({ length: 1500 }, () => '-x\n+y\n').join('')
  const review = report(pullReviewPlan(detail([file('a.ts', text)])).coverage)
  review.coverage.push(
    ...Array.from({ length: 500 }, (_, i) => ({
      path: `${i}` + '\n'.repeat(1000),
      state: 'unavailable' as const,
    })),
  )
  const call = vi.fn<Call>(async (_input: string) => output([]))
  const result = await run({
    review,
    call,
    intent: { title: 'Test', body: '\n'.repeat(8000) },
    readSnapshot: async () => '\n'.repeat(15_000),
  })
  expect(call.mock.calls[0][0].length).toBeLessThanOrEqual(240_000)
  expect(result.notVerified.join('\n')).toContain('reduced to fit')
  expect(result.analysis.contextFiles).toHaveLength(0)
})
