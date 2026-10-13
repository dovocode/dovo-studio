import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { decode, snapshotSchema, taskReviewReportSchema } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
const output = JSON.stringify({
  summary: 'Inspected the changed function and its callers',
  notVerified: ['Signed device restart'],
  findings: [
    {
      path: 'hello.txt',
      line: 1,
      severity: 'high',
      title: 'Lost greeting',
      trigger: 'Open the file',
      impact: 'The greeting is missing',
      suggestion: 'Restore the original greeting',
    },
  ],
})
async function setup(
  run: AgentAdapter['run'] = async (context) => context.onText(output),
  enabled = true,
) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: join(f.directory, '.git', 'review.sqlite'),
    ownerToken: 'review-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  if (enabled) s.preferences.save({ enableCodeReviews: true })
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Implement greeting',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Keep the original greeting',
  })
  s.store.updateTask(task.id, (t) => ({ ...t, status: 'review', sessionId: 'author-session' }))
  await writeFile(join(f.directory, 'hello.txt'), 'changed\n')
  const calls: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (context) => {
      calls.push(context)
      await run(context)
    },
  })
  const call = async (
    path: string,
    input: unknown,
    token = 'review-owner-token-at-least-32-characters',
  ) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/review/task/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const read = async () =>
    decode(taskReviewReportSchema, await (await call('read', { taskId: task.id })).json())
  return { f, runtime, s, task, calls, call, read }
}
it('requires experimental opt-in and preserves saved reviews when disabled', async () => {
  const f = await setup(undefined, false)
  const snapshot = async () =>
    decode(
      snapshotSchema,
      await (
        await fetch(`http://127.0.0.1:${f.runtime.port}/api/snapshot`, {
          headers: { Authorization: 'Bearer review-owner-token-at-least-32-characters' },
        })
      ).json(),
    )
  expect(f.s.preferences.get().enableCodeReviews).toBe(false)
  expect((await snapshot()).codeReviewsEnabled).toBe(false)
  expect((await f.call('read', { taskId: f.task.id })).status).toBe(403)
  expect((await f.call('start', { taskId: f.task.id, requestId: randomUUID() })).status).toBe(403)
  expect(f.calls).toHaveLength(0)
  const save = (enableCodeReviews: boolean) =>
    fetch(`http://127.0.0.1:${f.runtime.port}/api/runtime/preferences/save`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer review-owner-token-at-least-32-characters',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enableCodeReviews }),
    })
  expect((await save(true)).status).toBe(200)
  expect((await snapshot()).codeReviewsEnabled).toBe(true)
  expect((await f.call('start', { taskId: f.task.id, requestId: randomUUID() })).status).toBe(200)
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const reviewId = (await f.read()).reviews[0].id
  expect((await save(false)).status).toBe(200)
  expect((await snapshot()).codeReviewsEnabled).toBe(false)
  expect((await f.call('read', { taskId: f.task.id })).status).toBe(403)
  expect((await save(true)).status).toBe(200)
  expect((await f.read()).reviews[0].id).toBe(reviewId)
})
it('launches a fresh restricted reviewer, persists evidence, compares snapshots and sends fixes to the author', async () => {
  const f = await setup()
  expect(
    (await f.call('start', { taskId: f.task.id, requestId: randomUUID() }, 'wrong')).status,
  ).toBe(401)
  const requestId = randomUUID()
  expect((await f.call('start', { taskId: f.task.id, requestId })).status).toBe(200)
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  let report = await f.read()
  const review = report.reviews[0]
  expect(report.current).toBe(true)
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0].agent.permission).toBe('read-only')
  expect(f.calls[0].sessionId).toBeUndefined()
  expect(f.calls[0].cwd).toBe(f.f.directory)
  expect(f.calls[0].prompt).toContain('Keep the original greeting')
  expect(f.s.store.task(f.task.id).messages).toHaveLength(1)
  expect(review.findings[0]).toMatchObject({
    trigger: 'Open the file',
    impact: 'The greeting is missing',
  })
  expect((await f.call('start', { taskId: f.task.id, requestId })).status).toBe(200)
  expect(f.calls).toHaveLength(1)
  expect(
    (
      await f.call('finding', {
        taskId: f.task.id,
        reviewId: review.id,
        findingId: review.findings[0].id,
        status: 'dismissed',
        resolution: 'Expected behavior',
      })
    ).status,
  ).toBe(200)
  expect((await f.read()).reviews[0].findings[0].status).toBe('dismissed')
  await writeFile(join(f.f.directory, 'hello.txt'), 'fixed\n')
  const delta = await (await f.call('changes', { taskId: f.task.id, reviewId: review.id })).json()
  expect(delta.files[0]).toMatchObject({ before: 'changed\n', after: 'fixed\n' })
  expect((await f.read()).current).toBe(false)
  expect(
    (
      await f.call('fix', {
        taskId: f.task.id,
        reviewId: review.id,
        findingIds: [review.findings[0].id],
        messageId: randomUUID(),
      })
    ).status,
  ).toBe(200)
  await vi.waitFor(() => expect(f.calls).toHaveLength(2))
  expect(f.calls[1].agent.permission).toBe('ask')
  expect(f.calls[1].prompt).toContain('Lost greeting')
  expect((await f.read()).reviews[0].findings[0].status).toBe('addressed')
})
it('rejects invalid reports and concurrent reviews without waking the author', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const f = await setup(async (context) => {
    await gate
    context.onText('Looks fine')
  })
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  try {
    expect((await f.call('start', { taskId: f.task.id, requestId: randomUUID() })).status).toBe(409)
  } finally {
    release()
  }
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('failed'))
  expect((await f.read()).reviews[0].error).toContain('structured report')
  expect(f.s.store.task(f.task.id).queue).toBeUndefined()
})
it('approves only a completed current review with no open findings, and stale edits revoke it', async () => {
  const f = await setup()
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const review = (await f.read()).reviews[0]
  // Open finding blocks approval.
  expect(
    (await f.call('approve', { taskId: f.task.id, reviewId: review.id, approved: true })).status,
  ).toBe(409)
  expect((await f.read()).approved).toBe(false)
  await f.call('finding', {
    taskId: f.task.id,
    reviewId: review.id,
    findingId: review.findings[0].id,
    status: 'resolved',
    resolution: 'Checked the fix',
  })
  expect(
    (await f.call('approve', { taskId: f.task.id, reviewId: review.id, approved: true })).status,
  ).toBe(200)
  const approved = await f.read()
  expect(approved.approved).toBe(true)
  expect(approved.reviews[0].approval?.baseline).toBe(review.baseline)
  // A file change after approval revokes it (no longer current).
  await writeFile(join(f.f.directory, 'hello.txt'), 'changed again\n')
  const stale = await f.read()
  expect(stale.current).toBe(false)
  expect(stale.approved).toBe(false)
  expect(
    (await f.call('approve', { taskId: f.task.id, reviewId: review.id, approved: true })).status,
  ).toBe(409)
  // Undo clears the approval. Note the review snapshot was taken when the file held
  // 'changed\n'; restoring that exact content makes the review current again.
  await writeFile(join(f.f.directory, 'hello.txt'), 'changed\n')
  await vi.waitFor(async () => expect((await f.read()).current).toBe(true))
  await f.call('finding', {
    taskId: f.task.id,
    reviewId: review.id,
    findingId: review.findings[0].id,
    status: 'resolved',
    resolution: 'Checked the fix',
  })
  await f.call('approve', { taskId: f.task.id, reviewId: review.id, approved: true })
  expect((await f.read()).approved).toBe(true)
  await f.call('approve', { taskId: f.task.id, reviewId: review.id, approved: false })
  expect((await f.read()).approved).toBe(false)
})
it('never claims successful dispatch is verified and retains command exit evidence', async () => {
  const f = await setup()
  f.s.activity.add('tool', f.task.id, 'pnpm test', {
    turnId: 'turn',
    toolId: 'test',
    status: 'completed',
    event: {
      item: {
        type: 'commandExecution',
        command: 'pnpm test',
        exitCode: 1,
        aggregatedOutput: 'A test failed',
      },
    },
  })
  const report = await f.read()
  expect(report.commands[0]).toMatchObject({
    command: 'pnpm test',
    status: 'failed',
    exitCode: 1,
    output: 'A test failed',
  })
})

it('shares completed reports and finding decisions across devices and runtime restarts', async () => {
  const f = await setup()
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const review = (await f.read()).reviews[0]
  f.s.devices.add('Paired phone', 'review-phone-token-at-least-32-characters')
  expect(
    (
      await f.call(
        'finding',
        {
          taskId: f.task.id,
          reviewId: review.id,
          findingId: review.findings[0].id,
          status: 'resolved',
          resolution: 'Checked the fix',
        },
        'review-phone-token-at-least-32-characters',
      )
    ).status,
  ).toBe(200)
  await f.runtime.close()
  const restarted = await startRuntime({
    databasePath: join(f.f.directory, '.git', 'review.sqlite'),
    ownerToken: 'review-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(restarted.close)
  const saved = await restarted.services.taskReviews.read(f.task.id)
  expect(saved.reviews[0].findings[0]).toMatchObject({
    id: review.findings[0].id,
    status: 'resolved',
    resolution: 'Checked the fix',
  })
  expect(saved.current).toBe(true)
})
it('stops the reviewer without interrupting or waking the author', async () => {
  const f = await setup(async (context) => {
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    context.signal.throwIfAborted()
  })
  const response = decode(
    taskReviewReportSchema,
    await (await f.call('start', { taskId: f.task.id, requestId: randomUUID() })).json(),
  )
  await vi.waitFor(() => expect(f.calls).toHaveLength(1))
  expect(
    (await f.call('stop', { taskId: f.task.id, reviewId: response.reviews[0].id })).status,
  ).toBe(200)
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('cancelled'))
  expect(f.s.store.task(f.task.id).status).toBe('review')
  expect(f.s.store.task(f.task.id).messages).toHaveLength(1)
})
it('launches another fresh session with the original brief and previous findings', async () => {
  const f = await setup()
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const first = (await f.read()).reviews[0]
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const second = (await f.read()).reviews[0]
  expect(second.reviewerTaskId).not.toBe(first.reviewerTaskId)
  expect(f.calls[1].sessionId).toBeUndefined()
  expect(f.calls[1].prompt).toContain('Keep the original greeting')
  expect(f.calls[1].prompt).toContain('Lost greeting')
})
it('rejects reviewers that cannot enforce read-only access', async () => {
  const f = await setup()
  f.s.store.update((workspace) => ({
    ...workspace,
    agents: [...workspace.agents, { ...workspace.agents[0]!, id: 'unsupported', provider: 'grok' }],
  }))
  const response = await f.call('start', {
    taskId: f.task.id,
    requestId: randomUUID(),
    agentId: 'unsupported',
  })
  expect(response.status).toBe(400)
  expect(f.calls).toHaveLength(0)
  expect((await f.read()).reviews).toEqual([])
})
it('reconciles an interrupted persisted review before accepting the next pass', async () => {
  const f = await setup()
  await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const review = (await f.read()).reviews[0]
  f.s.db
    .prepare('UPDATE task_code_reviews SET value=? WHERE id=?')
    .run(JSON.stringify({ ...review, status: 'running' }), review.id)
  f.s.store.updateTask(review.reviewerTaskId!, (task) => ({ ...task, status: 'cancelled' }))
  expect((await f.call('start', { taskId: f.task.id, requestId: randomUUID() })).status).toBe(200)
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  expect((await f.read()).reviews[1].status).toBe('cancelled')
})

it('reviews committed branch changes with local edits and preserves the author working-file list', async () => {
  const f = await setup()
  await f.s.git.command(f.f.directory, ['branch', '-M', 'main'])
  await f.s.git.command(f.f.directory, ['checkout', '-b', 'review-feature'])
  await f.s.git.command(f.f.directory, ['add', 'hello.txt'])
  await f.s.git.command(f.f.directory, ['commit', '-m', 'Change greeting'])
  await writeFile(join(f.f.directory, 'new.txt'), 'local addition\n')
  const requestId = randomUUID()
  expect((await f.call('start', { taskId: f.task.id, requestId, scope: 'branch' })).status).toBe(
    200,
  )
  await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
  const report = await f.read()
  expect(report.current).toBe(true)
  expect(report.reviews[0].scope).toBe('branch')
  expect(report.reviews[0].files.map((file) => file.path)).toEqual(['hello.txt', 'new.txt'])
  expect(f.calls[0].prompt).toContain('including committed changes and local edits')
  expect(f.s.store.task(f.task.id).files).toEqual([])
  expect((await f.call('start', { taskId: f.task.id, requestId, scope: 'working' })).status).toBe(
    409,
  )
  await writeFile(join(f.f.directory, 'new.txt'), 'moved\n')
  expect((await f.read()).current).toBe(false)
})

it.each([true, false])(
  'requires actual passing command evidence for reviewer-confirmed fixes (evidence=%s)',
  async (passing) => {
    let round = 0
    let findingId = ''
    const f = await setup(async (context) => {
      if (++round === 1) {
        context.onText(output)
        return
      }
      if (passing && context.taskId)
        f.s.activity.add('tool', context.taskId, 'Regression check', {
          turnId: 'regression',
          toolId: 'regression',
          status: 'completed',
          event: {
            item: {
              type: 'commandExecution',
              command: 'pnpm test save',
              exitCode: 0,
              aggregatedOutput: 'Save regression passed',
            },
          },
        })
      context.onText(
        JSON.stringify({
          summary: 'Checked fix',
          findings: [],
          notVerified: ['Device behavior'],
          verifiedFixes: [
            {
              findingId,
              command: 'pnpm test save',
              evidence: 'The original greeting is restored and the regression check passes.',
            },
          ],
        }),
      )
    })
    await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
    await vi.waitFor(async () => expect((await f.read()).reviews[0].status).toBe('completed'))
    findingId = (await f.read()).reviews[0].findings[0].id
    await writeFile(join(f.f.directory, 'hello.txt'), 'fixed\n')
    await f.call('start', { taskId: f.task.id, requestId: randomUUID() })
    await vi.waitFor(async () =>
      expect((await f.read()).reviews[0].status).toBe(passing ? 'completed' : 'failed'),
    )
    const latest = (await f.read()).reviews[0]
    expect(latest.verifiedFixes?.[0].findingId).toBe(passing ? findingId : undefined)
    expect(latest.error?.includes('passing regression command') ?? false).toBe(!passing)
  },
)
