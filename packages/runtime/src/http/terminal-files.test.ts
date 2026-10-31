import { expect, it, vi } from 'vite-plus/test'
import { writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration } from '../testing/integration'
vi.setConfig(runtimeIntegration)
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
