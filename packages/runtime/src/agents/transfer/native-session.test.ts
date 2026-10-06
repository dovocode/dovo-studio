import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent, NativeSession } from '@dovo/protocol'
import {
  exportNativeSession,
  importNativeSession,
  removeImportedSession,
  transferHash,
} from './native-session'
import { runtimeIntegration } from '../../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function claude() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-native-transfer-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    destination = join(root, 'destination'),
    cwd = join(root, 'project'),
    target = join(root, 'other-project')
  const sessionId = randomUUID(),
    messageId = randomUUID()
  const agent: Agent = {
    id: 'agent',
    name: 'Claude',
    provider: 'claude',
    model: 'test',
    permission: 'ask',
    instructions: '',
    endpoint: process.execPath,
    env: { CLAUDE_CONFIG_DIR: source },
  }
  const path = join(source, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
  await mkdir(join(path, '..'), { recursive: true })
  const transcript =
    [
      {
        type: 'user',
        uuid: messageId,
        parentUuid: null,
        sessionId,
        cwd,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Remember: paired HTTP is allowed.' },
      },
      {
        type: 'assistant',
        uuid: randomUUID(),
        parentUuid: messageId,
        sessionId,
        cwd,
        timestamp: new Date().toISOString(),
        message: {
          id: 'synthetic',
          type: 'message',
          role: 'assistant',
          model: 'test',
          content: [{ type: 'text', text: 'Keep the complete native context.' }],
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n'
  await writeFile(path, transcript)
  const sidecar = join(path, '..', sessionId, 'subagents', 'agent-test.jsonl')
  await mkdir(join(sidecar, '..'), { recursive: true })
  await writeFile(
    sidecar,
    JSON.stringify({ type: 'progress', cwd, data: { context: 'subagent context' } }) + '\n',
  )
  const session = await exportNativeSession(agent, sessionId)
  return {
    agent: { ...agent, env: { CLAUDE_CONFIG_DIR: destination } },
    session,
    cwd,
    target,
    destination,
    transcript,
  }
}
it('imports Claude native context and sidecars through the real SDK history reader, with resumable ownership', async () => {
  const s = await claude()
  let planned: Array<{ path: string; hash: string }> = []
  const files = await importNativeSession(s.agent, s.session, s.cwd, s.target, [], (files) => {
    planned = files
  })
  expect(files).toHaveLength(2)
  expect(planned).toEqual(files)
  const transcript = await readFile(files[0].path, 'utf8')
  expect(transcript).toContain('Keep the complete native context.')
  expect(transcript).toContain(s.target)
  expect(transcript).not.toContain(`"cwd":"${s.cwd}"`)
  expect(await importNativeSession(s.agent, s.session, s.cwd, s.target, files)).toEqual(files)
  await expect(importNativeSession(s.agent, s.session, s.cwd, s.target)).rejects.toThrow(
    'already exists',
  )
  await removeImportedSession(files)
  await expect(readFile(files[0].path)).rejects.toMatchObject({ code: 'ENOENT' })
  // An aborted import may be retried with a fresh transfer ID.
  expect(await importNativeSession(s.agent, s.session, s.cwd, s.target)).toHaveLength(2)
})
it('rejects incompatible versions, bad hashes, path traversal and incomplete JSONL before publishing context', async () => {
  const s = await claude()
  await expect(
    importNativeSession(s.agent, { ...s.session, version: 'different' }, s.cwd, s.target),
  ).rejects.toThrow('versions differ')
  const corrupt = structuredClone(s.session)
  corrupt.files[0].hash = '0'.repeat(64)
  await expect(importNativeSession(s.agent, corrupt, s.cwd, s.target)).rejects.toThrow('checksum')
  const traversal = structuredClone(s.session)
  traversal.files[1].path = '../escape'
  await expect(importNativeSession(s.agent, traversal, s.cwd, s.target)).rejects.toThrow('path')
  const incomplete: NativeSession = structuredClone(s.session)
  const bytes = Buffer.from(s.transcript.trimEnd())
  incomplete.files[0] = {
    ...incomplete.files[0],
    data: bytes.toString('base64'),
    hash: transferHash(bytes),
  }
  await expect(importNativeSession(s.agent, incomplete, s.cwd, s.target)).rejects.toThrow(
    'incomplete',
  )
})
it('never overwrites existing native files or deletes context changed after staging', async () => {
  const s = await claude()
  const files = await importNativeSession(s.agent, s.session, s.cwd, s.target)
  await writeFile(files[0].path, 'changed context\n')
  await expect(importNativeSession(s.agent, s.session, s.cwd, s.target, files)).rejects.toThrow(
    'already exists',
  )
  await removeImportedSession(files)
  expect(await readFile(files[0].path, 'utf8')).toBe('changed context\n')
})
