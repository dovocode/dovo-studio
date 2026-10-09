/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun } from '../../execution/types.js'
import { acpClientTools } from './acp-client-tools.js'

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
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
  return { cwd, controller, run, tools: await acpClientTools(run, () => 'session') }
}

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

it('admits at most eight concurrent ACP terminal requests', async () => {
  const { cwd, tools } = await setup('workspace-write')
  const createTerminal = tools.client.createTerminal
  if (!createTerminal) throw new Error('Expected terminal access')
  try {
    const requests = await Promise.allSettled(
      Array.from({ length: 9 }, async () =>
        createTerminal({
          sessionId: 'session',
          cwd,
          command: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 1000)'],
        }),
      ),
    )
    expect(requests.filter((request) => request.status === 'fulfilled')).toHaveLength(8)
    expect(requests.filter((request) => request.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ message: 'ACP terminal limit reached' }),
      }),
    ])
  } finally {
    await tools.close()
  }
})

it('rejects an approved terminal request after client tools have closed', async () => {
  const { run, tools } = await setup()
  const approving = barrier()
  const release = barrier()
  run.approve = async () => {
    approving.resolve()
    await release.promise
    return true
  }
  const request = tools.client.createTerminal?.({ sessionId: 'session', command: process.execPath })
  try {
    await approving.promise
    await tools.close()
    release.resolve()
    await expect(request).rejects.toThrow('client tools are closed')
  } finally {
    release.resolve()
    await tools.close()
  }
})

it('rechecks cancellation after the final terminal path lookup', async () => {
  const { cwd, controller, tools } = await setup('full-access')
  const entered = barrier()
  const release = barrier()
  const realpath = fsPromises.realpath
  let calls = 0
  vi.spyOn(fsPromises, 'realpath').mockImplementation(async (path) => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
    return realpath(path)
  })
  syncBuiltinESMExports()
  const request = tools.client.createTerminal?.({
    sessionId: 'session',
    cwd,
    command: process.execPath,
  })
  try {
    await entered.promise
    controller.abort()
    release.resolve()
    await expect(request).rejects.toThrow('Task cancelled')
  } finally {
    release.resolve()
    await tools.close()
  }
})

it('drains an already-started file write before closing client tools', async () => {
  const { cwd, tools } = await setup('workspace-write')
  const entered = barrier()
  const release = barrier()
  const open = fsPromises.open
  vi.spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args)
    const write = handle.writeFile.bind(handle)
    vi.spyOn(handle, 'writeFile').mockImplementation(async (data) => {
      entered.resolve()
      await release.promise
      return write(data)
    })
    return handle
  })
  syncBuiltinESMExports()
  const path = join(cwd, 'drained.txt')
  const writing = tools.client.writeTextFile?.({ sessionId: 'session', path, content: 'saved' })
  try {
    await entered.promise
    let closed = false
    const closing = tools.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve()
    await writing
    await closing
    expect(await readFile(path, 'utf8')).toBe('saved')
  } finally {
    release.resolve()
    await tools.close()
  }
})

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

it('accepts workspace edits but still asks before ACP terminal commands', async () => {
  const { cwd, tools } = await setup('workspace-write', false)
  await tools.client.writeTextFile?.({
    sessionId: 'session',
    path: join(cwd, 'edited.txt'),
    content: 'edited',
  })
  expect(await readFile(join(cwd, 'edited.txt'), 'utf8')).toBe('edited')
  await expect(
    tools.client.createTerminal?.({ sessionId: 'session', command: process.execPath }),
  ).rejects.toThrow('declined')
  await tools.close()
})

it('allows full access outside the workspace without approval prompts', async () => {
  const { tools } = await setup('full-access', false)
  const outside = await mkdtemp(join(tmpdir(), 'dovo-acp-full-access-'))
  dirs.push(outside)
  const file = join(outside, 'created.txt')
  await tools.client.writeTextFile?.({ sessionId: 'session', path: file, content: 'allowed' })
  expect(await tools.client.readTextFile?.({ sessionId: 'session', path: file })).toEqual({
    content: 'allowed',
  })
  const terminal = await tools.client.createTerminal?.({
    sessionId: 'session',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    cwd: outside,
  })
  expect(
    (
      await tools.client.waitForTerminalExit?.({
        sessionId: 'session',
        terminalId: terminal!.terminalId,
      })
    )?.exitCode,
  ).toBe(0)
  await tools.close()
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

it('keeps child terminals isolated and drains only the stopped child session', async () => {
  const { run } = await setup('workspace-write')
  const tools = await acpClientTools(
    run,
    () => 'session',
    (id) => ['session', 'child'].includes(id),
  )
  const create = tools.client.createTerminal
  const output = tools.client.terminalOutput
  if (!create || !output) throw new Error('Expected ACP terminal access')
  try {
    const root = await create({
      sessionId: 'session',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const child = await create({
      sessionId: 'child',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    expect(() => output({ sessionId: 'session', terminalId: child.terminalId })).toThrow(
      'unavailable',
    )
    await tools.stopSession('child')
    expect(() => output({ sessionId: 'child', terminalId: child.terminalId })).toThrow(
      'unavailable',
    )
    expect(output({ sessionId: 'session', terminalId: root.terminalId })).toMatchObject({
      output: '',
    })
  } finally {
    await tools.close()
  }
})
