import { afterEach, expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  defaultTaskHarness,
  pullCodeReviewBody,
  pullDetailSchema,
  decode,
  type TitleGenerationSettings,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import type { AgentRun, AgentAdapter } from '../agents/execution/types.js'
import { pullReviewEvidence } from '../scm/reviews/pull-code-reviews.js'
import { openDatabase } from '../storage/database.js'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
const head = 'a'.repeat(40),
  base = 'b'.repeat(40)
const selection: TitleGenerationSettings = {
  harness: defaultTaskHarness('claude'),
  agentId: '',
  model: 'review-model',
  reasoning: '',
}
const patch = '@@ -1 +1 @@\n-original\n+changed\n'
const finding = {
  path: 'hello.txt',
  side: 'after',
  line: 1,
  severity: 'high',
  title: 'Lost greeting',
  trigger: 'Read the greeting',
  impact: 'The expected greeting is lost',
  suggestion: 'Keep the greeting',
  evidence: 'changed',
  confidence: 9,
}
const output = JSON.stringify({ summary: 'Found one bug.', notVerified: [], findings: [finding] })
function detail() {
  const value = decode(pullDetailSchema, {
    destination: 'destination',
    pull: {
      number: 42,
      title: 'Greeting',
      body: '',
      url: 'https://github.com/acme/repo/pull/42',
      repositoryUrl: 'https://github.com/acme/repo',
      state: 'open',
      draft: false,
      author: 'author',
      updatedAt: '2026-11-15',
      head: 'feature',
      base: 'main',
      headSha: head,
      baseSha: base,
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      mergeable: true,
      labels: [],
      reviewers: [],
      assignees: [],
    },
    files: [{ path: 'hello.txt', status: 'modified', additions: 1, deletions: 1, patch }],
    comments: [],
    checks: [],
    warnings: [],
  })
  return {
    ...value,
    destination: 'destination',
    pull: { ...value.pull, destination: 'destination' },
  }
}
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'pr-reviews.sqlite')
  const runtime = await startRuntime({
    databasePath,
    ownerToken: 'pr-review-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ enableCodeReviews: true })
  const source = {
    provider: 'github' as const,
    repository: 'acme/repo',
    host: 'github.com',
    readerIdentity: 'reader',
    destination: 'destination',
    viewerLogin: 'dominic',
    validate: () => {},
  }
  const guard = vi.spyOn(s.pulls, 'guard').mockResolvedValue(source)
  let current = detail()
  vi.spyOn(s.pulls, 'section').mockImplementation(async () => structuredClone(current))
  const status = vi
    .spyOn(s.pulls, 'status')
    .mockImplementation(async () => structuredClone(current))
  const feedback = vi
    .spyOn(s.pulls, 'feedback')
    .mockImplementation(async () => structuredClone(current))
  const act = vi.spyOn(s.pulls, 'act').mockResolvedValue({
    number: 42,
    url: 'https://github.com/acme/repo/pull/42#review-1',
    status: 'submitted',
  })
  const calls: AgentRun[] = []
  const agent = vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (input) => {
      calls.push(input)
      if (input.agent.instructions?.startsWith('Challenge the proposed PR findings')) {
        const payload = JSON.parse(input.prompt.slice(input.prompt.indexOf('{'))) as {
          candidates: { id: string }[]
        }
        input.onText(
          JSON.stringify({
            decisions: payload.candidates.map((candidate) => ({
              id: candidate.id,
              verdict: 'keep',
              confidence: 9,
              reason: 'Supported by the changed line.',
            })),
          }),
        )
      } else input.onText(output)
    },
  })
  const target = { repositoryId: 'repo', number: 42, expectedDestination: 'destination' }
  const start = (requestId = 'start-1') =>
    s.pullCodeReviews.start({ target, requestId, headSha: head, baseSha: base, selection })
  const completed = async () => {
    await vi.waitFor(async () =>
      expect((await s.pullCodeReviews.read(target)).reviews[0]?.status).not.toBe('running'),
    )
    return (await s.pullCodeReviews.read(target)).reviews[0]
  }
  return {
    f,
    runtime,
    s,
    source,
    guard,
    status,
    agent,
    target,
    calls,
    act,
    feedback,
    start,
    completed,
    databasePath,
    setDetail: (value: ReturnType<typeof detail>) => {
      current = value
    },
  }
}
it('runs a fresh tools-disabled review, validates anchors, and saves a model separate from titles', async () => {
  const f = await setup()
  const titles = f.s.titles.read()
  await f.start()
  const review = await f.completed()
  expect(review.status).toBe('completed')
  expect(review.findings[0]).toMatchObject({ anchored: true, path: 'hello.txt', side: 'after' })
  expect(f.calls[0]).toMatchObject({
    tools: 'none',
    ephemeral: true,
    agent: { resources: undefined, permission: 'read-only', model: 'review-model' },
  })
  expect(f.calls[0].cwd).not.toBe(f.f.directory)
  expect(existsSync(f.calls[0].cwd)).toBe(false)
  expect(f.calls[0].agent.instructions).toContain('untrusted data')
  expect(f.s.titles.read()).toEqual(titles)
  expect((await f.s.pullCodeReviews.read(f.target)).selection).toMatchObject({
    model: 'review-model',
    harness: { provider: 'claude' },
  })
  await f.start()
  expect(f.calls).toHaveLength(2)
})
it('persists review depth, keeps check consent per request, and rejects changed retry options', async () => {
  const f = await setup()
  const input = {
    target: f.target,
    requestId: 'depth-options',
    headSha: head,
    baseSha: base,
    selection,
    depth: 'quick' as const,
    runChecks: true,
  }
  await f.s.pullCodeReviews.start(input)
  const review = await f.completed()
  expect(review).toMatchObject({ depth: 'quick', runChecks: true, checks: [{ status: 'skipped' }] })
  expect((await f.s.pullCodeReviews.read(f.target)).depth).toBe('quick')
  expect(f.calls[0].prompt).toContain('projectChecks')
  await expect(f.s.pullCodeReviews.start({ ...input, depth: 'thorough' })).rejects.toMatchObject({
    status: 409,
  })
  await expect(f.s.pullCodeReviews.start({ ...input, runChecks: false })).rejects.toMatchObject({
    status: 409,
  })
  await f.s.pullCodeReviews.start({
    ...input,
    requestId: 'without-check-consent',
    runChecks: undefined,
  })
  expect((await f.completed()).runChecks).toBe(false)
})
it('reads context from captured Git commits and ignores later working-tree edits', async () => {
  const f = await setup()
  const directory = f.f.directory
  const baseSha = (await f.s.git.command(directory, ['rev-parse', 'HEAD'])).trim()
  const source = "import {value} from './dep.js'\nexport const saved = value\n"
  await writeFile(join(directory, 'source.ts'), source)
  await writeFile(join(directory, 'dep.ts'), 'export const value = "committed dependency"\n')
  await f.s.git.command(directory, ['add', 'source.ts', 'dep.ts'])
  await f.s.git.command(directory, ['commit', '-qm', 'Saved PR snapshot'])
  const headSha = (await f.s.git.command(directory, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(directory, 'source.ts'), 'DIRTY SOURCE MUST NOT REACH REVIEW\n')
  await writeFile(join(directory, 'dep.ts'), 'DIRTY DEPENDENCY MUST NOT REACH REVIEW\n')
  const current = detail()
  f.setDetail({
    ...current,
    pull: { ...current.pull, headSha, baseSha },
    files: [
      {
        path: 'source.ts',
        status: 'added',
        additions: 2,
        deletions: 0,
        patch: '@@ -0,0 +1,2 @@\n+' + source.trimEnd().replaceAll('\n', '\n+') + '\n',
      },
    ],
  })
  f.agent.mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (input) => {
      f.calls.push(input)
      input.onText(
        JSON.stringify({ summary: 'No grounded findings', findings: [], notVerified: [] }),
      )
    },
  })
  await f.s.pullCodeReviews.start({
    target: f.target,
    requestId: 'real-git',
    headSha,
    baseSha,
    selection,
  })
  const review = await f.completed()
  expect(review.status).toBe('completed')
  expect(review.analysis?.contextFiles).toEqual([
    { path: 'source.ts', ref: headSha, text: source },
    { path: 'dep.ts', ref: headSha, text: 'export const value = "committed dependency"\n' },
  ])
  expect(f.calls[0].prompt).toContain('committed dependency')
  expect(f.calls[0].prompt).not.toContain('DIRTY')
  expect(f.calls[0]).toMatchObject({
    tools: 'none',
    ephemeral: true,
    agent: { resources: undefined, permission: 'read-only' },
  })
})
it('keeps drafts, rejects conflicting writes, and blocks stale or changed previews', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  const draft = { ...review.draft, body: 'My edited review' }
  await f.s.pullCodeReviews.save(f.target, review.id, 0, draft)
  await expect(
    f.s.pullCodeReviews.save(f.target, review.id, 0, { ...draft, body: 'Overwrite' }),
  ).rejects.toMatchObject({ status: 409 })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  await expect(
    f.s.pullCodeReviews.publish(
      f.target,
      review.id,
      review.version,
      'publish-1',
      'different preview',
    ),
  ).rejects.toMatchObject({ status: 409 })
  f.setDetail({ ...detail(), pull: { ...detail().pull, headSha: 'c'.repeat(40) } })
  await expect(
    f.s.pullCodeReviews.publish(
      f.target,
      review.id,
      review.version,
      'publish-1',
      pullCodeReviewBody(review),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect(f.act).not.toHaveBeenCalled()
  expect((await f.s.pullCodeReviews.read(f.target)).reviews[0].draft.body).toBe('My edited review')
})
it('rejects a reused start ID with changed revision, model or remaining pass', async () => {
  const f = await setup()
  await f.start()
  const review = await f.completed()
  for (const change of [
    { headSha: 'c'.repeat(40) },
    { baseSha: 'c'.repeat(40) },
    { selection: { ...selection, model: 'another-model' } },
    { remainingFrom: review.id },
  ]) {
    await expect(
      f.s.pullCodeReviews.start({
        target: f.target,
        requestId: 'start-1',
        headSha: head,
        baseSha: base,
        selection,
        ...change,
      }),
    ).rejects.toMatchObject({ status: 409 })
  }
  await f.start()
  expect(f.calls).toHaveLength(2)
})
it('preserves a posted review with an unconfirmed decision without reposting', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, {
    ...review.draft,
    body: 'Please fix the draft',
    event: 'request-changes',
  })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  f.act.mockResolvedValueOnce({
    number: 42,
    status: 'submitted',
    url: review.url,
    pendingReviewDecision: 'request-changes',
    message: 'Text posted, but the decision was not confirmed.',
  })
  const result = await f.s.pullCodeReviews.publish(
    f.target,
    review.id,
    review.version,
    'publish-partial',
    pullCodeReviewBody(review),
  )
  expect(result.reviews[0].publication).toMatchObject({
    status: 'published',
    pendingReviewDecision: 'request-changes',
    notice: 'Text posted, but the decision was not confirmed.',
  })
  await f.s.pullCodeReviews.publish(
    f.target,
    review.id,
    review.version,
    'publish-partial',
    pullCodeReviewBody(review),
  )
  expect(f.act).toHaveBeenCalledTimes(1)
})
it('rejects unsupported forge decisions before recording publication intent', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, {
    ...review.draft,
    body: 'Please fix',
    event: 'request-changes',
  })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  f.setDetail({
    ...detail(),
    capabilities: { actions: ['review'], reviewDecisions: ['comment'], mergeMethods: [] },
  })
  await expect(
    f.s.pullCodeReviews.publish(
      f.target,
      review.id,
      review.version,
      'publish-unsupported',
      pullCodeReviewBody(review),
    ),
  ).rejects.toMatchObject({ status: 400 })
  expect(f.act).not.toHaveBeenCalled()
  expect((await f.s.pullCodeReviews.read(f.target)).reviews[0].publication).toBeUndefined()
})
it('rejects incomplete reviewer setup without saving a report or reviewer preference', async () => {
  const f = await setup()
  for (const invalid of [
    { ...selection, model: '' },
    { ...selection, harness: defaultTaskHarness('hermes') },
    { ...selection, harness: undefined, agentId: 'missing' },
  ]) {
    await expect(
      f.s.pullCodeReviews.start({
        target: f.target,
        requestId: 'invalid',
        headSha: head,
        baseSha: base,
        selection: invalid,
      }),
    ).rejects.toMatchObject({ status: 400 })
  }
  expect(await f.s.pullCodeReviews.read(f.target)).toEqual({ reviews: [] })
  expect(f.calls).toHaveLength(0)
})
it('keeps a newer draft saved while publication checks the forge', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, {
    ...review.draft,
    body: 'Previewed draft',
  })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  f.status.mockImplementationOnce(async () => {
    await f.s.pullCodeReviews.save(f.target, review.id, review.version, {
      ...review.draft,
      body: 'New text from another client',
    })
    return detail()
  })
  await expect(
    f.s.pullCodeReviews.publish(
      f.target,
      review.id,
      review.version,
      'publish-race',
      pullCodeReviewBody(review),
    ),
  ).rejects.toMatchObject({ status: 409 })
  const saved = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  expect(saved.draft.body).toBe('New text from another client')
  expect(saved.version).toBe(review.version + 1)
  expect(saved.sequence).toBeGreaterThan(review.sequence)
  expect(saved.publication).toBeUndefined()
  expect(f.act).not.toHaveBeenCalled()
})
it('reconciles a timeout after the forge accepted a review without posting twice', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, {
    ...review.draft,
    body: 'One review only',
  })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  f.act.mockRejectedValueOnce(new Error('Timed out after POST'))
  const body = pullCodeReviewBody(review)
  await f.s.pullCodeReviews.publish(f.target, review.id, review.version, 'publish-1', body)
  expect((await f.s.pullCodeReviews.read(f.target)).reviews[0].publication?.status).toBe('unknown')
  const remote = detail()
  remote.comments.push({
    id: 'review-1',
    kind: 'review',
    author: 'dominic',
    body,
    date: '2026-11-15',
    url: `${remote.pull.url}#review-1`,
  })
  f.setDetail(remote)
  await f.s.pullCodeReviews.publish(f.target, review.id, review.version, 'publish-1', body)
  expect((await f.s.pullCodeReviews.read(f.target)).reviews[0].publication?.status).toBe(
    'published',
  )
  expect(f.act).toHaveBeenCalledTimes(1)
  expect(f.feedback).toHaveBeenCalledTimes(1)
})
it('refuses an uncertain retry when no remote marker is visible', async () => {
  const f = await setup()
  await f.start()
  let review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, { ...review.draft, body: 'Review' })
  review = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  f.act.mockRejectedValueOnce(new Error('Connection closed'))
  await f.s.pullCodeReviews.publish(
    f.target,
    review.id,
    review.version,
    'publish-1',
    pullCodeReviewBody(review),
  )
  await expect(
    f.s.pullCodeReviews.publish(
      f.target,
      review.id,
      review.version,
      'publish-1',
      pullCodeReviewBody(review),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect(f.act).toHaveBeenCalledTimes(1)
})
it('filters invented paths and stops a reviewer that attempts tools', async () => {
  const f = await setup()
  const reviewer = vi
    .spyOn(f.s.titles, 'reviewPull')
    .mockResolvedValueOnce(output.replace('hello.txt', '../secret'))
  await f.start()
  expect((await f.completed()).analysis?.rejectedFindings).toBe(1)
  reviewer.mockRestore()
  f.agent.mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (input) => {
      input.onActivity('Read')
      input.onText(output)
    },
  })
  await f.start('start-2')
  expect((await f.completed()).status).not.toBe('completed')
})
it('reports partial and omitted evidence without cutting patches or looping oversized files', () => {
  const value = detail()
  value.pull.changedFiles = 6
  value.files.push(
    { ...value.files[0], path: 'missing', patch: undefined },
    { ...value.files[0], path: 'huge', patch: patch.repeat(100) },
    { ...value.files[0], path: 'partial', patch: '@@ -1,2 +1,2 @@\n one\n' },
    { ...value.files[0], path: 'another', patch },
  )
  const evidence = pullReviewEvidence(value, new Set(), 200)
  expect(evidence.coverage.map((file) => file.state)).toEqual([
    'supplied',
    'unavailable',
    'too-large',
    'partial',
    'budget',
  ])
  expect(evidence.missingFiles).toBe(1)
  const remaining = pullReviewEvidence(value, new Set(['hello.txt']), 200)
  expect(remaining.coverage.at(-1)?.state).toBe('supplied')
})
it('requires the feature gate and paired authentication at the HTTP boundary', async () => {
  const f = await setup()
  const request = (token: string) =>
    fetch(`http://127.0.0.1:${f.runtime.port}/api/review/pull/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: f.target,
        requestId: 'http-1',
        headSha: head,
        baseSha: base,
        selection,
      }),
    })
  expect((await request('wrong-token')).status).toBe(401)
  f.s.preferences.save({ enableCodeReviews: false })
  expect((await request('pr-review-owner-token-at-least-32-characters')).status).toBe(403)
  expect(f.calls).toHaveLength(0)
})
it('reviews failed and omitted batches again while preserving successful coverage from earlier passes', async () => {
  const f = await setup()
  const current = detail()
  const large = '@@ -1 +1 @@\n-original\n+' + 'x'.repeat(100_000) + '\n'
  f.setDetail({
    ...current,
    pull: { ...current.pull, changedFiles: 5 },
    files: Array.from({ length: 5 }, (_, i) => ({
      path: `${i}.txt`,
      status: 'modified',
      additions: 1,
      deletions: 1,
      patch: large,
    })),
  })
  const reviewer = vi
    .spyOn(f.s.titles, 'reviewPull')
    .mockResolvedValue(
      JSON.stringify({ summary: 'Completed batch', findings: [], notVerified: [] }),
    )
    .mockRejectedValueOnce(new Error('Temporary model failure'))
  await f.start()
  const first = await f.completed()
  expect(first.status).toBe('completed')
  expect(first.coverage.map((file) => file.state)).toEqual([
    'failed',
    'supplied',
    'supplied',
    'supplied',
    'budget',
  ])
  expect(reviewer).toHaveBeenCalledTimes(4)
  await f.s.pullCodeReviews.start({
    target: f.target,
    requestId: 'remaining',
    headSha: head,
    baseSha: base,
    selection,
    remainingFrom: first.id,
  })
  const next = await f.completed()
  expect(next.status).toBe('completed')
  expect(next.coverage.map((file) => file.state)).toEqual([
    'supplied',
    'previous-pass',
    'previous-pass',
    'previous-pass',
    'supplied',
  ])
  expect(reviewer).toHaveBeenCalledTimes(6)
  expect((await f.s.pullCodeReviews.read(f.target)).reviews[1].coverage).toEqual(first.coverage)
})

it('keeps drafts across restart and recovers unfinished work without restarting or reposting', async () => {
  const f = await setup()
  await f.start()
  const review = await f.completed()
  await f.s.pullCodeReviews.save(f.target, review.id, 0, {
    ...review.draft,
    body: 'Keep my draft across restart',
  })
  const close = cleanups.pop()
  if (close) await close()
  const db = openDatabase(f.databasePath)
  // Simulate the durable state left by a process exit during a run and publication.
  db.prepare(
    "UPDATE pull_code_reviews SET value=json_set(value, '$.status', 'running', '$.publication', json(?)) WHERE id=?",
  ).run(
    JSON.stringify({
      requestId: 'publish-1',
      body: 'Saved publication text',
      event: 'comment',
      status: 'publishing',
    }),
    review.id,
  )
  db.prepare(
    "UPDATE pull_code_reviews SET value=json_set(value, '$.checks', json(?)) WHERE id=?",
  ).run(
    JSON.stringify([
      {
        name: 'lint',
        command: 'pnpm run lint',
        headSha: review.headSha,
        status: 'running',
        output: 'Started',
      },
    ]),
    review.id,
  )
  // Older reports predate snapshot context and exact finding evidence.
  db.prepare(
    "UPDATE pull_code_reviews SET value=json_remove(value, '$.depth', '$.runChecks', '$.analysis', '$.intent', '$.findings[0].evidence', '$.findings[0].confidence', '$.findings[0].verification') WHERE id=?",
  ).run(review.id)
  db.close()
  const restarted = await startRuntime({
    databasePath: f.databasePath,
    ownerToken: 'pr-review-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(restarted.close)
  vi.spyOn(restarted.services.pulls, 'guard').mockResolvedValue(f.source)
  const act = vi.spyOn(restarted.services.pulls, 'act')
  const model = vi.spyOn(restarted.services.titles, 'reviewPull')
  const saved = (await restarted.services.pullCodeReviews.read(f.target)).reviews[0]
  expect(saved.draft.body).toBe('Keep my draft across restart')
  expect(saved.status).toBe('interrupted')
  expect(saved.publication?.status).toBe('unknown')
  expect(saved.analysis).toBeUndefined()
  expect(saved.depth).toBeUndefined()
  expect(saved.checks).toMatchObject([
    { status: 'interrupted', output: expect.stringContaining('Runtime stopped') },
  ])
  expect(saved.findings[0]).toMatchObject({ title: finding.title, anchored: true })
  expect(act).not.toHaveBeenCalled()
  expect(model).not.toHaveBeenCalled()
})

it('permits one active pass per PR and propagates cancellation to the utility run', async () => {
  const f = await setup()
  let signal: AbortSignal | undefined
  vi.spyOn(f.s.titles, 'reviewPull').mockImplementation(
    (_text, _selection, incoming) =>
      new Promise((_resolve, reject) => {
        signal = incoming
        incoming.addEventListener('abort', () => reject(incoming.reason), { once: true })
      }),
  )
  const first = await f.start()
  await expect(f.start('another-client')).rejects.toMatchObject({ status: 409 })
  await f.s.pullCodeReviews.stop(f.target, first.reviews[0].id)
  expect(signal?.aborted).toBe(true)
  expect((await f.completed()).status).toBe('cancelled')
})

it('filters unsupported code evidence and separates reader histories', async () => {
  const f = await setup()
  vi.spyOn(f.s.titles, 'reviewPull').mockResolvedValueOnce(output.replace('"line":1', '"line":999'))
  await f.start()
  expect((await f.completed()).findings).toEqual([])
  f.guard.mockResolvedValue({ ...f.source, readerIdentity: 'another-reader' })
  expect((await f.s.pullCodeReviews.read(f.target)).reviews).toEqual([])
})

it('runs independent models against the same evidence and combines exact findings with attribution', async () => {
  const f = await setup()
  const second = {
    ...selection,
    harness: { provider: 'codex' as const, endpoint: '' },
    model: 'second-reviewer',
  }
  await f.s.pullCodeReviews.start({
    target: f.target,
    requestId: 'multi',
    headSha: head,
    baseSha: base,
    selection,
    reviewers: [second],
  })
  const review = await f.completed()
  expect(review.status).toBe('completed')
  expect(
    review.reviewerResults?.map((item) => [
      item.selection.model,
      item.status,
      item.completedBatches,
    ]),
  ).toEqual([
    ['review-model', 'completed', 1],
    ['second-reviewer', 'completed', 1],
  ])
  expect(review.findings).toHaveLength(1)
  expect(review.findings[0].reviewerIds).toEqual(['reviewer-1', 'reviewer-2'])
  expect(f.calls.map((call) => call.agent.model)).toEqual([
    'review-model',
    'review-model',
    'second-reviewer',
    'second-reviewer',
  ])
  expect(f.calls.every((call) => call.tools === 'none' && call.agent.resources === undefined)).toBe(
    true,
  )
  await expect(
    f.s.pullCodeReviews.start({
      target: f.target,
      requestId: 'multi',
      headSha: head,
      baseSha: base,
      selection,
      reviewers: [{ ...second, model: 'changed-model' }],
    }),
  ).rejects.toThrow('another revision or reviewer')
})

it('keeps the completed reviewer report when another provider fails', async () => {
  const f = await setup()
  const adapter = await f.s.agents.get('claude')
  f.agent.mockImplementation(async (provider) =>
    provider === 'codex'
      ? {
          ...adapter,
          run: async () => {
            throw new Error('Provider unavailable')
          },
        }
      : adapter,
  )
  await f.s.pullCodeReviews.start({
    target: f.target,
    requestId: 'partial',
    headSha: head,
    baseSha: base,
    selection,
    reviewers: [
      { ...selection, harness: { provider: 'codex', endpoint: '' }, model: 'offline-model' },
    ],
  })
  const review = await f.completed()
  expect(review.status).toBe('completed')
  expect(review.findings).toHaveLength(1)
  expect(review.reviewerResults?.map((item) => item.status)).toEqual(['completed', 'failed'])
  expect(review.notVerified.join('\n')).toContain('Provider unavailable')
})

it('sends validated image bytes to both analysis and challenge and removes temporary files', async () => {
  const f = await setup()
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const adapter = await f.s.agents.get('claude')
  let inspected = 0
  f.agent.mockResolvedValue({
    ...adapter,
    run: async (input) => {
      expect(input.attachments?.[0]).toMatchObject({
        name: 'screenshot.png',
        mime: 'image/png',
        data: png,
      })
      expect(existsSync(input.attachments?.[0].path ?? '')).toBe(true)
      expect(input.tools).toBe('none')
      inspected++
      await adapter.run(input)
    },
  })
  const input = {
    target: f.target,
    requestId: 'visual',
    headSha: head,
    baseSha: base,
    selection,
    images: [{ name: 'screenshot.png', data: png }],
  }
  await f.s.pullCodeReviews.start(input)
  const review = await f.completed()
  expect(review.status).toBe('completed')
  expect(inspected).toBe(2)
  expect(review.images?.[0]).toMatchObject({ name: 'screenshot.png', mime: 'image/png' })
  expect(review.images?.[0]).not.toHaveProperty('data')
  expect(f.calls.every((call) => !existsSync(call.attachments?.[0].path ?? ''))).toBe(true)
  await f.s.pullCodeReviews.start(input)
  expect(inspected).toBe(2)
  await expect(
    f.s.pullCodeReviews.start({ ...input, images: [{ name: 'different.png', data: png }] }),
  ).rejects.toThrow('another revision or reviewer')
})

it('keeps earlier findings when a later reviewer is cancelled', async () => {
  const f = await setup()
  const adapter = await f.s.agents.get('claude')
  let secondStarted = false
  f.agent.mockResolvedValue({
    ...adapter,
    run: async (input) => {
      if (input.agent.model !== 'waiting-model') return adapter.run(input)
      secondStarted = true
      await new Promise<void>((_resolve, reject) => {
        if (input.signal.aborted) reject(input.signal.reason)
        else
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
      })
    },
  })
  await f.s.pullCodeReviews.start({
    target: f.target,
    requestId: 'cancel-multi',
    headSha: head,
    baseSha: base,
    selection,
    reviewers: [{ ...selection, model: 'waiting-model' }],
  })
  await vi.waitFor(() => expect(secondStarted).toBe(true))
  const active = (await f.s.pullCodeReviews.read(f.target)).reviews[0]
  expect(active.findings).toHaveLength(1)
  expect(active.analysis?.activeBatch).toBe(2)
  await f.s.pullCodeReviews.stop(f.target, active.id)
  const review = await f.completed()
  expect(review.status).toBe('cancelled')
  expect(review.findings).toHaveLength(1)
  expect(review.reviewerResults?.map((reviewer) => reviewer.status)).toEqual([
    'completed',
    'cancelled',
  ])
})
