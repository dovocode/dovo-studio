import { expect, it, vi } from 'vite-plus/test'
import { open, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
vi.mock('node:fs/promises', { spy: true })
it('serves bounded prefixes and line windows without allowing a preview to overwrite the full file', async () => {
  const f = await fixture(),
    token = 'bounded-preview-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Preview',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    const contents = Array.from(
      { length: 100000 },
      (_, i) => `line ${i + 1} abcdefghijklmnopqrstuvwxyz\n`,
    ).join('')
    await writeFile(join(f.directory, 'large.txt'), contents)
    const call = (path: string, input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, path: 'large.txt', ...input }),
      })
    const prefix = await call('read', { preview: {} })
    expect(prefix.status).toBe(200)
    const data = await prefix.json()
    expect(data.size).toBe(Buffer.byteLength(contents))
    expect(data.complete).toBe(false)
    expect(data.truncated).toBe(true)
    expect(Buffer.byteLength(data.contents)).toBeLessThanOrEqual(256 * 1024)
    const window = await call('read', { preview: { startLine: 90000, maxBytes: 4096 } })
    expect(window.status).toBe(200)
    expect(await window.json()).toMatchObject({
      startLine: 90000,
      truncated: true,
      complete: false,
      contents: expect.stringMatching(/^line 90000 /),
    })
    expect((await call('read', { preview: { maxBytes: 1024 * 1024 + 1 } })).status).toBe(400)
    expect(
      (await call('write', { expectedContents: data.contents, contents: 'lost remainder' })).status,
    ).toBe(413)
    const reads = vi
      .mocked(open)
      .mock.calls.flatMap((args, index) =>
        args[0] === join(f.directory, 'large.txt') ? [vi.mocked(open).mock.results[index]] : [],
      )
    expect(reads).toHaveLength(3)
    for (const result of reads) {
      if (result.type !== 'return') throw new Error('File open failed before the preview read')
      expect((await result.value).fd).toBe(-1)
    }
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

it('computes saved preview patches only when a client requests them', async () => {
  const f = await fixture(),
    token = 'preview-patch-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Patch',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    await writeFile(join(f.directory, 'hello.txt'), 'changed\n')
    const call = (patch?: boolean) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/file/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, path: 'hello.txt', working: true, patch }),
      })
    const plain = await call()
    expect(plain.status).toBe(200)
    const preview = await plain.json()
    expect(preview.after.text).toBe('changed\n')
    expect(preview.patch).toBeUndefined()
    const patched = await call(true)
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({
      before: preview.before,
      after: preview.after,
      patch: expect.stringContaining('+changed'),
    })
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

it('serves bounded text and structured previews of contained final-component aliases', async () => {
  const f = await fixture()
  const token = 'bounded-symlink-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Alias',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    await writeFile(join(f.directory, 'safe.txt'), 'first\nsecond\n')
    await symlink('safe.txt', join(f.directory, 'alias.txt'))
    await symlink('.git/config', join(f.directory, 'git.txt'))
    await symlink('absent.txt', join(f.directory, 'dangling.txt'))
    await symlink(join(f.directory, '..'), join(f.directory, 'outside'))
    const call = (operation: string, path: string, input: Record<string, unknown> = {}) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/${operation}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, path, ...input }),
      })
    const bounded = await call('read', 'alias.txt', { preview: { startLine: 2, maxBytes: 32 } })
    expect(bounded.status).toBe(200)
    expect(await bounded.json()).toMatchObject({ path: 'alias.txt', contents: 'second\n' })
    const structured = await call('preview', 'alias.txt')
    expect(structured.status).toBe(200)
    expect(await structured.json()).toMatchObject({ after: { text: 'first\nsecond\n' } })
    for (const path of ['git.txt', 'dangling.txt', 'outside/private.txt']) {
      expect((await call('read', path, { preview: {} })).ok).toBe(false)
      expect((await call('preview', path)).ok).toBe(false)
    }
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
