import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  decode,
  codexSessionImportResultSchema,
  codexSessionListSchema,
  codexSessionPreviewSchema,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import * as activity from '../agents/providers/pi/session-activity.js'
import { requireImportedPiSession } from '../agents/providers/pi/session-import.js'
import type { AgentAdapter } from '../agents/execution/types.js'

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
