import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decode, mutableStruct, type Agent, type NativeSession } from '@dovo/protocol'
import { Schema } from 'effect'
import { importNativeSession, transferHash } from './native-session'

const rpc = vi.hoisted(() => ({
  sendRequest: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  sendNotification: vi.fn<(method: string, params: unknown) => Promise<void>>(),
}))
vi.mock('../catalogs/rpc', () => ({
  withCatalogRpc: async (
    _executable: string,
    _args: string[],
    load: (client: typeof rpc) => Promise<unknown>,
  ) => load(rpc),
}))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.clearAllMocks()
})
it('preserves opaque Codex context, remaps session metadata and indexes through thread/resume without starting a turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-codex-transfer-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const sessionId = randomUUID(),
    target = join(root, 'project')
  const history = JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'compaction',
      encrypted_content: 'opaque-preserved-context',
      text: '/old/path should stay as history',
    },
  })
  const data = Buffer.from(
    JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: '/old/path' } }) +
      '\n' +
      history +
      '\n',
  )
  const agent: Agent = {
    id: 'agent',
    name: 'Codex',
    provider: 'codex',
    model: '',
    permission: 'ask',
    instructions: '',
    endpoint: process.execPath,
    env: { CODEX_HOME: join(root, 'home') },
  }
  const session: NativeSession = {
    provider: 'codex',
    sessionId,
    version: process.version,
    files: [
      {
        path: `sessions/2026/10/06/rollout-test-${sessionId}.jsonl`,
        data: data.toString('base64'),
        hash: transferHash(data),
      },
    ],
  }
  rpc.sendRequest.mockImplementation(async (method, params) => {
    if (method === 'initialize') return {}
    const input = decode(mutableStruct({ path: Schema.String }), params)
    await appendFile(
      input.path,
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'thread_settings_applied', thread_id: sessionId },
      }) + '\n',
    )
    return { thread: { id: sessionId } }
  })
  let beforeIndex: Array<{ path: string; hash: string }> = []
  const files = await importNativeSession(agent, session, '/old/path', target, [], (files) => {
    if (!beforeIndex.length) beforeIndex = files
  })
  const transcript = await readFile(files[0].path, 'utf8')
  expect(transcript.split('\n')[1]).toBe(history)
  expect(JSON.parse(transcript.split('\n')[0]).payload.cwd).toBe(target)
  expect(rpc.sendRequest).toHaveBeenCalledWith('thread/resume', {
    threadId: sessionId,
    path: files[0].path,
    cwd: target,
  })
  expect(rpc.sendRequest.mock.calls.map((call) => call[0])).toEqual(['initialize', 'thread/resume'])
  expect(files[0].hash).not.toBe(beforeIndex[0].hash)
  // Recover a crash after the provider appended settings but before ownership was persisted.
  expect(await importNativeSession(agent, session, '/old/path', target, beforeIndex)).toHaveLength(
    1,
  )
  await expect(importNativeSession(agent, session, '/old/path', target)).rejects.toThrow(
    'already exists',
  )
  // No unrelated file is overwritten even when a caller supplies a previously owned path.
  await writeFile(files[0].path, 'unrelated data')
  await expect(importNativeSession(agent, session, '/old/path', target, files)).rejects.toThrow(
    'already exists',
  )
})
