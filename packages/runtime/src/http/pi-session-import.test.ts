import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  decode,
  codexSessionImportResultSchema,
  codexSessionListSchema,
  codexSessionPreviewSchema,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import * as activity from '../agents/providers/pi/session-activity.js'
import { requireImportedPiSession } from '../agents/providers/pi/session-import.js'
import type { AgentAdapter } from '../agents/execution/types.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const files = await importOriginal<typeof import('node:fs/promises')>()
  return { ...files, rm: vi.fn<typeof files.rm>(files.rm) }
})
vi.setConfig(runtimeIntegration)
afterEach(() => vi.restoreAllMocks())

it('imports a project Pi session once across restarts and refuses active sessions', async () => {
  const f = await fixture()
  const directory = await realpath(f.directory)
  const sessions = join(directory, 'pi-sessions')
  await mkdir(sessions)
  const path = join(sessions, 'session.jsonl')
  await writeFile(
    path,
    [
      { type: 'session', version: 3, id: 'pi-test', cwd: directory },
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'Question' } },
      {
        type: 'message',
        id: 'b',
        parentId: 'a',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await utimes(path, new Date('2026-01-01'), new Date('2026-01-01'))
  const probe = vi.spyOn(activity, 'piSessionActivity').mockResolvedValue('active')
  const token = 'pi-import-owner-token-with-enough-characters'
  const options = { port: 0, databasePath: join(directory, 'runtime.sqlite'), ownerToken: token }
  let runtime = await startRuntime(options)
  try {
    f.workspace.agents[0] = {
      ...f.workspace.agents[0]!,
      provider: 'pi',
      env: { PI_CODING_AGENT_SESSION_DIR: sessions },
    }
    runtime.services.store.update(() => f.workspace)
    const input = { repositoryId: 'repo', agentId: 'agent' }
    const request = (operation: string, body: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/pi-sessions/${operation}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const list = decode(codexSessionListSchema, await (await request('list', input)).json())
    expect(list.sessions).toHaveLength(1)
    const key = list.sessions[0]!.key
    const preview = async () =>
      decode(codexSessionPreviewSchema, await (await request('preview', { ...input, key })).json())
    expect((await preview()).status).toBe('active')
    probe.mockResolvedValue('unknown')
    const detail = await preview()
    expect(detail.status).toBe('available')
    expect(detail.notice).toContain('private copy')
    expect(detail.messages.map((message) => message.text)).toEqual(['Question', 'Answer'])
    const original = await readFile(path, 'utf8')
    await writeFile(path, '{"type":"session_info","id":"c","parentId":"b","name":"Changed"}\n', {
      flag: 'a',
    })
    await utimes(path, new Date('2026-01-01'), new Date('2026-01-01'))
    expect((await request('import', { ...input, key, revision: detail.revision })).status).toBe(409)
    await writeFile(path, original)
    await utimes(path, new Date('2026-01-01'), new Date('2026-01-01'))
    const imports = await Promise.all(
      [0, 1].map(async () =>
        decode(
          codexSessionImportResultSchema,
          await (await request('import', { ...input, key, revision: detail.revision })).json(),
        ),
      ),
    )
    const first = imports.find((result) => !result.existing)!
    expect(imports.filter((result) => result.existing)).toHaveLength(1)
    expect(imports[0]?.id).toBe(imports[1]?.id)
    const task = runtime.services.store.task(first.id)
    expect(task.importedPiSession?.cwd).toBe(directory)
    expect(task.importedPiSession?.transcriptPath).toBe(path)
    expect(task.importedPiSession?.privatePath).toBe(task.sessionId)
    expect(task.sessionId).not.toBe(path)
    expect(await readFile(task.sessionId!, 'utf8')).toBe(await readFile(path, 'utf8'))
    await writeFile(
      task.sessionId!,
      '{"type":"session_info","id":"c","parentId":"b","name":"private update"}\n',
      { flag: 'a' },
    )
    expect(await readFile(path, 'utf8')).not.toContain('private update')
    await rm(path)
    probe.mockResolvedValue('active')
    await expect(requireImportedPiSession(task)).resolves.toBeUndefined()
    await runtime.close()
    runtime = await startRuntime(options)
    const repeated = decode(
      codexSessionImportResultSchema,
      await (await request('import', { ...input, key, revision: detail.revision })).json(),
    )
    expect(repeated).toEqual({ id: first.id, existing: true })
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onSession(task.sessionId!)
      input.onPromptAccepted?.()
      input.onText('New reply')
    })
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    const sent = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: first.id,
        messageId: 'new-input',
        text: 'Continue now',
        attachmentIds: [],
      }),
    })
    expect(sent.status).toBe(200)
    await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(1))
    await waitForRuntime(() =>
      expect(runtime.services.store.task(first.id).activeRunId).toBeUndefined(),
    )
    expect(run.mock.calls[0]?.[0]).toMatchObject({ cwd: directory, sessionId: task.sessionId })
    expect(run.mock.calls[0]?.[0].prompt).toContain('Continue now')
    expect(run.mock.calls[0]?.[0].prompt).not.toContain('Question')
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

it('removes the private copy of a deleted Pi import, keeps the original and retries or recovers cleanup', async () => {
  const f = await fixture()
  const directory = await realpath(f.directory)
  const sessions = join(directory, 'pi-sessions')
  await mkdir(sessions)
  const transcript = async (id: string) => {
    const path = join(sessions, `${id}.jsonl`)
    await writeFile(
      path,
      [
        { type: 'session', version: 3, id, cwd: directory },
        { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'Hi' } },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
    )
    await utimes(path, new Date('2026-01-01'), new Date('2026-01-01'))
    return path
  }
  const originals = [await transcript('pi-first'), await transcript('pi-second')]
  vi.spyOn(activity, 'piSessionActivity').mockResolvedValue('inactive')
  const token = 'pi-delete-owner-token-with-enough-characters'
  const options = { port: 0, databasePath: join(directory, 'runtime.sqlite'), ownerToken: token }
  let runtime = await startRuntime(options)
  const request = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  try {
    f.workspace.agents[0] = {
      ...f.workspace.agents[0]!,
      provider: 'pi',
      env: { PI_CODING_AGENT_SESSION_DIR: sessions },
    }
    runtime.services.store.update(() => f.workspace)
    const input = { repositoryId: 'repo', agentId: 'agent' }
    const list = decode(
      codexSessionListSchema,
      await (await request('/api/tasks/pi-sessions/list', input)).json(),
    )
    const imported = []
    for (const session of list.sessions) {
      const preview = decode(
        codexSessionPreviewSchema,
        await (
          await request('/api/tasks/pi-sessions/preview', { ...input, key: session.key })
        ).json(),
      )
      const result = decode(
        codexSessionImportResultSchema,
        await (
          await request('/api/tasks/pi-sessions/import', {
            ...input,
            key: session.key,
            revision: preview.revision,
          })
        ).json(),
      )
      imported.push(runtime.services.store.task(result.id))
    }
    expect(imported).toHaveLength(2)
    const [deleted, crashed] = imported as [Task, Task]
    const copy = (task: Task) => task.importedPiSession!.privatePath!
    const exists = (path: string) =>
      stat(path).then(
        () => true,
        () => false,
      )
    expect(await exists(copy(deleted))).toBe(true)
    // The deletion commits even if the file removal fails. Repeating the request retries it.
    const original = vi.mocked(rm).getMockImplementation()!
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (path === copy(deleted)) throw new Error('Injected busy file')
      return original(path, options)
    })
    const removed = await request('/api/tasks/lifecycle', { id: deleted.id, action: 'delete' })
    expect(removed.status).toBe(200)
    expect(runtime.services.store.get().tasks.some((task) => task.id === deleted.id)).toBe(false)
    expect(await exists(copy(deleted))).toBe(true)
    vi.mocked(rm).mockImplementation(original)
    const repeated = await request('/api/tasks/lifecycle', { id: deleted.id, action: 'delete' })
    expect(repeated.status).toBe(200)
    expect(await exists(copy(deleted))).toBe(false)
    // A crash after the deletion commits, before file cleanup, leaves the copy. Restart removes it.
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.filter((task) => task.id !== crashed.id),
    }))
    expect(await exists(copy(crashed))).toBe(true)
    await runtime.close()
    runtime = await startRuntime(options)
    await waitForRuntime(async () => expect(await exists(copy(crashed))).toBe(false))
    for (const original of originals) expect(await exists(original)).toBe(true)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
