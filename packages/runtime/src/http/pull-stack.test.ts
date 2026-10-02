import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { PullDetail } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
it('verifies the parent at submission, rejects changed or closed parents and records the dependency', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'stack-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => f.workspace)
  const parent: PullDetail = {
    pull: {
      number: 1,
      title: 'Parent',
      url: 'https://github.com/test/repo/pull/1',
      repositoryUrl: 'https://github.com/test/repo',
      head: 'test:parent',
      base: 'test:main',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      state: 'open',
      draft: false,
      author: 'test',
      updatedAt: '2026-10-02',
      labels: [],
      body: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    files: [],
    checks: [],
    comments: [],
    warnings: [],
  }
  const detail = vi.spyOn(runtime.services.pulls, 'detail').mockResolvedValue(parent)
  const create = vi
    .spyOn(runtime.services.pulls, 'create')
    .mockResolvedValue({ status: 'created', number: 2, url: 'https://github.com/test/repo/pull/2' })
  const submit = (extra: Record<string, unknown> = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/pulls/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repositoryId: 'repo',
        title: 'Child',
        body: 'Changes',
        head: 'child',
        base: 'parent',
        parentNumber: 1,
        parentHeadSha: parent.pull.headSha,
        ...extra,
      }),
    })
  expect((await submit({ parentHeadSha: 'c'.repeat(40) })).status).toBe(409)
  expect((await submit({ base: 'main' })).status).toBe(409)
  expect((await submit({ parentHeadSha: undefined })).status).toBe(400)
  expect((await submit({ head: 'parent' })).status).toBe(400)
  detail.mockResolvedValueOnce({ ...parent, pull: { ...parent.pull, state: 'merged' } })
  expect((await submit()).status).toBe(409)
  expect(create).not.toHaveBeenCalled()
  const response = await submit()
  expect(response.status).toBe(200)
  expect(create).toHaveBeenCalledWith(
    f.directory,
    expect.objectContaining({
      base: 'parent',
      head: 'child',
      body: 'Changes\n\nStack parent: [#1](https://github.com/test/repo/pull/1)',
    }),
  )
})
