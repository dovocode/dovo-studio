import { afterEach, expect, it } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverPiSessions, piSessionsDirectory } from './session-discovery.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

it('discovers flat and nested sessions only within the selected project', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'dovo-pi-discovery-'))
  directories.push(root)
  const sessions = join(root, 'sessions'),
    project = join(root, 'project')
  await fs.mkdir(join(sessions, 'nested'), { recursive: true })
  await fs.mkdir(project)
  const header = (id: string, cwd: string) => JSON.stringify({ type: 'session', id, cwd }) + '\n'
  await fs.writeFile(join(sessions, 'flat.jsonl'), header('flat', project))
  await fs.writeFile(
    join(sessions, 'nested', 'nested.jsonl'),
    header('nested', join(project, 'subdir')),
  )
  await fs.writeFile(join(sessions, 'other.jsonl'), header('other', root))
  await fs.symlink(join(sessions, 'flat.jsonl'), join(sessions, 'link.jsonl'))
  const result = await discoverPiSessions(sessions, [project])
  expect(result.sessions.map((item) => item.sessionId).sort()).toEqual(['flat', 'nested'])
  expect(new Set(result.sessions.map((item) => item.key)).size).toBe(2)
  expect(result.limited).toBe(false)
})

it('uses the explicit session directory before the agent directory', () => {
  expect(
    piSessionsDirectory(
      { PI_CODING_AGENT_SESSION_DIR: '/sessions', PI_CODING_AGENT_DIR: '/agent' },
      '/home/user',
    ),
  ).toBe('/sessions')
  expect(piSessionsDirectory({ PI_CODING_AGENT_DIR: '/agent' }, '/home/user')).toBe(
    '/agent/sessions',
  )
  expect(piSessionsDirectory({}, '/home/user')).toBe('/home/user/.pi/agent/sessions')
})
