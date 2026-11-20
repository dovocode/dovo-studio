import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../index'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const comment = {
  repositoryId: 'repo',
  number: 7,
  headSha: 'a'.repeat(40),
  path: 'src/app.ts',
  side: 'additions',
  start: 3,
  end: 3,
  body: 'Please rename this.',
}

it('posts one PR line comment per submission ID and reports it after a runtime restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-pull-comment-receipts-'))
  directories.push(directory)
  const databasePath = join(directory, 'runtime.sqlite')
  const ownerToken = 'pull-comment-receipt-owner-token-at-least-32-chars'
  const phone = 'pull-comment-receipt-phone-token-at-least-32-chars'
  const other = 'pull-comment-receipt-other-token-at-least-32-chars'
  const start = async () => {
    const runtime = await startRuntime({ databasePath, ownerToken, port: 0 })
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Repo', path: directory, branch: 'main' }],
    }))
    const posts = vi
      .spyOn(runtime.services.pulls, 'comment')
      .mockResolvedValue({ url: 'https://github.com/team/project/pull/7#discussion_r1' })
    const call = (path: string, input: unknown, token = phone) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    return { runtime, posts, call }
  }
  const submissionId = '6f1c2a3e-7b4d-4c5e-9f60-1a2b3c4d5e6f'
  let current = await start()
  try {
    current.runtime.services.devices.add('Phone', phone)
    current.runtime.services.devices.add('Other phone', other)
    const snapshot = await fetch(`http://127.0.0.1:${current.runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${phone}` },
    })
    expect(await snapshot.json()).toMatchObject({ pullCommentReceiptsSupported: true })
    const status = async (token = phone) =>
      (await current.call('/api/scm/pulls/comment-status', { submissionId }, token)).json()
    expect(await status()).toEqual({ status: 'unknown' })

    const first = await current.call('/api/scm/pulls/comment', { ...comment, submissionId })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      url: 'https://github.com/team/project/pull/7#discussion_r1',
    })
    // The response was lost. The same press returns the first outcome without a second post.
    const repeat = await current.call('/api/scm/pulls/comment', { ...comment, submissionId })
    expect(await repeat.json()).toEqual({
      url: 'https://github.com/team/project/pull/7#discussion_r1',
    })
    expect(current.posts).toHaveBeenCalledTimes(1)
    // One ID cannot post different text.
    const changed = await current.call('/api/scm/pulls/comment', {
      ...comment,
      body: 'Different',
      submissionId,
    })
    expect(changed.status).toBe(409)
    expect(current.posts).toHaveBeenCalledTimes(1)
    // Receipts belong to the paired device that posted.
    expect(await status(other)).toEqual({ status: 'unknown' })

    await current.runtime.close()
    current = await start()
    expect(await status()).toEqual({
      status: 'posted',
      url: 'https://github.com/team/project/pull/7#discussion_r1',
    })
    expect(current.posts).not.toHaveBeenCalled()

    // Without an ID, the route keeps its earlier behavior.
    expect((await current.call('/api/scm/pulls/comment', comment)).status).toBe(200)
    expect(current.posts).toHaveBeenCalledTimes(1)
    expect(
      (await current.call('/api/scm/pulls/comment-status', { submissionId: 'x' })).status,
    ).toBe(400)
  } finally {
    await current.runtime.close()
  }
})

it('reports a rejected or interrupted submission without posting it', async () => {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'pull-comment-receipt-owner-token-at-least-32-chars',
    port: 0,
  })
  try {
    const phone = 'pull-comment-receipt-phone-token-at-least-32-chars'
    runtime.services.devices.add('Phone', phone)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Repo', path: '/pull-comment-receipt', branch: 'main' }],
    }))
    const call = (path: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${phone}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const { HttpError } = await import('../errors')
    const posts = vi
      .spyOn(runtime.services.pulls, 'comment')
      .mockRejectedValueOnce(new HttpError(422, 'Line is outside the diff'))
      .mockRejectedValueOnce(new Error('GitHub timed out'))
    const rejected = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
    expect(
      (await call('/api/scm/pulls/comment', { ...comment, submissionId: rejected })).status,
    ).toBe(422)
    expect(
      await (await call('/api/scm/pulls/comment-status', { submissionId: rejected })).json(),
    ).toEqual({ status: 'rejected', error: 'Line is outside the diff' })
    const failed = '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f'
    expect(
      (await call('/api/scm/pulls/comment', { ...comment, submissionId: failed })).status,
    ).toBe(500)
    // A failure after the request may have reached the forge stays uncertain.
    expect(
      await (await call('/api/scm/pulls/comment-status', { submissionId: failed })).json(),
    ).toEqual({ status: 'uncertain' })
    expect(posts).toHaveBeenCalledTimes(2)
  } finally {
    await runtime.close()
  }
})
