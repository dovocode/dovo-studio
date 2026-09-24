/// <reference types="node" />
import { afterEach, expect, it } from 'vitest'
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun } from '../types.js'
import { acpClientTools } from './acp-client-tools.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function setup(permission: AgentRun['agent']['permission'] = 'ask', approved = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-acp-tools-'))
  dirs.push(cwd)
  const controller = new AbortController()
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Agent',
      provider: 'acp',
      model: '',
      instructions: '',
      permission,
      endpoint: 'fixture',
    },
    cwd,
    prompt: '',
    signal: controller.signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    approve: async () => approved,
    ask: async () => null,
  }
  return { cwd, controller, tools: await acpClientTools(run, () => 'session') }
}

it('reads within the workspace and refuses symlink escapes', async () => {
  const { cwd, tools } = await setup('read-only')
  await writeFile(join(cwd, 'file.txt'), 'first\nsecond\nthird')
  expect(
    await tools.client.readTextFile?.({
      sessionId: 'session',
      path: join(cwd, 'file.txt'),
      line: 2,
      limit: 1,
    }),
  ).toEqual({ content: 'second' })
  await symlink('/etc/hosts', join(cwd, 'escape'))
  await expect(
    tools.client.readTextFile?.({ sessionId: 'session', path: join(cwd, 'escape') }),
  ).rejects.toThrow('outside the workspace')
  expect(tools.client.writeTextFile).toBeUndefined()
  expect(tools.client.createTerminal).toBeUndefined()
  await tools.close()
})

it('requires approval for writes and terminal commands', async () => {
  const denied = await setup('ask', false)
  await expect(
    denied.tools.client.writeTextFile?.({
      sessionId: 'session',
      path: join(denied.cwd, 'blocked.txt'),
      content: 'no',
    }),
  ).rejects.toThrow('declined')
  await expect(
    denied.tools.client.createTerminal?.({
      sessionId: 'session',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("no")'],
    }),
  ).rejects.toThrow('declined')
  await denied.tools.close()

  const allowed = await setup()
  await allowed.tools.client.writeTextFile?.({
    sessionId: 'session',
    path: join(allowed.cwd, 'allowed.txt'),
    content: 'yes',
  })
  expect(await readFile(join(allowed.cwd, 'allowed.txt'), 'utf8')).toBe('yes')
  const created = await allowed.tools.client.createTerminal?.({
    sessionId: 'session',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("done")'],
  })
  expect(created?.terminalId).toBeDefined()
  const status = await allowed.tools.client.waitForTerminalExit?.({
    sessionId: 'session',
    terminalId: created!.terminalId,
  })
  expect(status?.exitCode).toBe(0)
  expect(
    (
      await allowed.tools.client.terminalOutput?.({
        sessionId: 'session',
        terminalId: created!.terminalId,
      })
    )?.output,
  ).toContain('done')
  await allowed.tools.close()
})

it('refuses symlink and hard-link file writes', async () => {
  const { cwd, tools } = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-acp-outside-'))
  dirs.push(outside)
  const original = join(outside, 'original.txt')
  await writeFile(original, 'untouched')
  await symlink(original, join(cwd, 'symlink.txt'))
  await link(original, join(cwd, 'hardlink.txt'))
  for (const name of ['symlink.txt', 'hardlink.txt']) {
    await expect(
      tools.client.writeTextFile?.({
        sessionId: 'session',
        path: join(cwd, name),
        content: 'changed',
      }),
    ).rejects.toThrow(/symbolic link|regular file/)
  }
  expect(await readFile(original, 'utf8')).toBe('untouched')
  await tools.close()
})
