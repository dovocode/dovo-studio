import { expect, it, vi } from 'vite-plus/test'
import { open, writeFile, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
vi.mock('node:fs/promises', { spy: true })
it('pages through a long line without splitting UTF-8 and rejects cursors after replacement', async () => {
  const f = await fixture()
  const token = 'bounded-preview-cursor-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Paged preview',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    const contents = 'a'.repeat(128 * 1024 - 1) + '😃'.repeat(40000) + '\nlast page'
    const filename = join(f.directory, 'long.txt')
    await writeFile(filename, contents)
    const read = (cursor?: string, startLine?: number) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          path: 'long.txt',
          preview: { cursor, startLine, maxBytes: 128 * 1024 },
        }),
      })
    const page = async (cursor?: string) => {
      const response = await read(cursor)
      expect(response.status).toBe(200)
      return await response.json()
    }
    const first = await page()
    expect(first.contents).toBe('a'.repeat(128 * 1024 - 1))
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await page(first.nextCursor)
    const last = await page(second.nextCursor)
    expect(second.contents.startsWith('😃')).toBe(true)
    expect(first.contents + second.contents + last.contents).toBe(contents)
    expect(last).toMatchObject({ hasMore: false, startLine: 1 })
    expect(last.nextCursor).toBeUndefined()
    expect(await page(first.cursor)).toEqual(first)
    expect(await (await read(undefined, 2)).json()).toMatchObject({ contents: 'last page' })
    await writeFile(filename + '.replacement', contents.replace('last page', 'new bytes'))
    await rename(filename + '.replacement', filename)
    expect((await read(first.nextCursor)).status).toBe(409)
    expect((await read('invalid')).status).toBe(400)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
it('decodes GB18030 pages and line links without splitting a four-byte character', async () => {
  const f = await fixture()
  const token = 'legacy-preview-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Legacy text',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    // 中 (GBK), then 😀 (four-byte GB18030), then a second line.
    await writeFile(join(f.directory, 'legacy.txt'), Buffer.from('d6d09439fc360aa1a1', 'hex'))
    const read = async (preview: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, path: 'legacy.txt', preview }),
      })
      expect(response.status).toBe(200)
      return response.json()
    }
    const first = await read({ maxBytes: 4 })
    expect(first).toMatchObject({ contents: '中', encoding: 'gb18030', hasMore: true })
    const second = await read({ cursor: first.nextCursor, maxBytes: 7 })
    expect(second).toMatchObject({ contents: '😀\n　', encoding: 'gb18030', hasMore: false })
    expect(await read({ startLine: 2 })).toMatchObject({ contents: '　', startLine: 2 })
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

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
    const rtf = String.raw`{\rtf1\ansi\uc1 {\fonttbl{\f0 Arial;}}\b Hello\b0 {\i world}\par{\field{\*\fldinst HYPERLINK "https://hidden.invalid"}{\fldrslt <label>}} \u-10179?\u-8701?\page Second}`
    await writeFile(join(f.directory, 'document.rtf'), rtf)
    const formatted = await call('read', 'document.rtf', { preview: { format: 'rtf' } })
    expect(formatted.status).toBe(200)
    const document = (await formatted.json()).document
    expect(document).toHaveLength(2)
    expect(document[0].map((span: { text: string }) => span.text).join('')).toBe(
      'Helloworld\n<label> 😃',
    )
    expect(document[0]).toEqual(
      expect.arrayContaining([
        { text: 'Hello', bold: true },
        { text: 'world', italic: true },
      ]),
    )
    expect(document[1]).toEqual([{ text: 'Second' }])
    const source = await call('read', 'document.rtf', { preview: {} })
    expect(await source.json()).toMatchObject({ contents: rtf, complete: true })
    await writeFile(join(f.directory, 'broken.rtf'), String.raw`{\rtf1 missing brace`)
    expect((await call('read', 'broken.rtf', { preview: { format: 'rtf' } })).status).toBe(422)
    for (const path of ['git.txt', 'dangling.txt', 'outside/private.txt']) {
      expect((await call('read', path, { preview: {} })).ok).toBe(false)
      expect((await call('preview', path)).ok).toBe(false)
    }
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
