import { expect, it, vi } from 'vite-plus/test'
import { realpath, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration } from '../testing/integration'
import { decode, responses, STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { exec } from '../process'
import { parse } from 'shell-quote'
vi.setConfig(runtimeIntegration)
it('browses and compares the standalone terminal checkout without creating a task', async () => {
  const f = await fixture()
  const token = 'terminal-workspace-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const linked = join(f.directory, 'linked')
    await exec('git', ['worktree', 'add', '-b', 'linked', linked], { cwd: f.directory })
    await writeFile(join(linked, 'hello.txt'), 'Edited in the terminal checkout\n')
    const directory = await realpath(linked)
    const terminal = s.terminals.createCommand(
      STUDIO_TERMINAL_SCOPE,
      directory,
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
      'Linked terminal',
      undefined,
      'repo',
      { directory, execution: 'worktree' },
    )
    const call = (path: string, input: object, credential = token, agent = false) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
          ...(agent ? { 'x-dovo-agent-access': '1' } : {}),
        },
        body: JSON.stringify(input),
      })
    const input = { id: terminal.id, path: 'hello.txt' }
    const read = 'terminals/workspace/read'
    expect((await call(read, input, 'invalid')).status).toBe(401)
    expect((await call(read, input, token, true)).status).toBe(403)
    expect(await (await call(read, input)).json()).toMatchObject({
      contents: 'Edited in the terminal checkout\n',
    })
    expect(
      await (await call('terminals/workspace/files', { id: terminal.id })).json(),
    ).toMatchObject({
      entries: [{ path: 'hello.txt', kind: 'file' }],
    })
    expect(
      await (await call('terminals/workspace/changes', { id: terminal.id })).json(),
    ).toMatchObject({
      files: [{ path: 'hello.txt' }],
    })
    expect((await call(read, { ...input, path: '../hello.txt' })).status).toBe(400)
    const devices = vi
      .spyOn(s.deviceHosts, 'list')
      .mockResolvedValue({ host: 'Fixture computer', devices: [], diagnostics: [] })
    expect((await call('previews/devices', { taskId: STUDIO_TERMINAL_SCOPE })).status).toBe(200)
    expect(
      (await call('previews/devices', { taskId: STUDIO_TERMINAL_SCOPE }, token, true)).status,
    ).toBe(403)
    expect(devices).toHaveBeenCalledOnce()
    expect(s.store.get().tasks).toEqual([])
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
it('quotes existing dropped paths without submitting input and rejects unauthenticated or invalid requests', async () => {
  const f = await fixture()
  const token = 'terminal-drop-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const terminal = runtime.services.terminals.createCommand(
      'task',
      f.directory,
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
      'Drop paths',
    )
    const shell = runtime.services.terminals.get(terminal.id).process
    if (!shell) throw new Error('Expected a running terminal')
    const write = vi.spyOn(shell, 'write')
    const call = (paths: string[], credential = token, id = terminal.id) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/terminals/quote-paths`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, paths }),
      })
    const paths = ['/tmp/with spaces.txt', "/tmp/it's.txt", '/tmp/$(touch nope)']
    expect((await call(paths, 'invalid')).status).toBe(401)
    const result = await call(paths)
    expect(result.status).toBe(200)
    const { text } = decode(responses.terminalPaths, await result.json())
    expect(parse(text)).toEqual(paths)
    expect(write).not.toHaveBeenCalled()
    for (const invalid of [[], ['line\nbreak'], [''], Array.from({ length: 101 }, () => '/file')])
      expect((await call(invalid)).status).toBe(400)
    expect((await call(paths, token, 'missing')).status).toBe(404)
    await runtime.services.terminals.close(terminal.id)
    expect((await call(paths)).status).toBe(404)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
it('resolves terminal locations within the original authorized checkout and rejects escapes and moved checkouts', async () => {
  const f = await fixture()
  const token = 'terminal-files-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Locations',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    await writeFile(join(f.directory, 'source.ts'), 'const x = 1\n')
    const terminal = s.terminals.createCommand(
      task.id,
      f.directory,
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
      'Source',
    )
    const call = (path: string, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/terminals/file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: terminal.id, path }),
      })
    expect((await call('source.ts', 'invalid')).status).toBe(401)
    for (const path of ['source.ts', join(f.directory, 'source.ts')]) {
      const result = await call(path)
      expect(result.status).toBe(200)
      expect(await result.json()).toEqual({ taskId: task.id, path: 'source.ts' })
    }
    for (const path of ['../escape.ts', '.git/config', '/etc/passwd'])
      expect((await call(path)).status).toBe(400)
    await symlink('/etc/passwd', join(f.directory, 'escape.txt'))
    expect((await call('escape.txt')).status).toBe(400)
    expect((await call('missing.ts')).status).toBeGreaterThanOrEqual(400)
    vi.spyOn(s.checkouts, 'selectedDirectory').mockResolvedValue(join(f.directory, '.git'))
    expect((await call('source.ts')).status).toBe(409)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
