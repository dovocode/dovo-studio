import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration } from '../../testing/integration.js'
import type { AgentAdapter } from '../execution/types.js'
import { stopOwnedChild } from '../execution/stop-owned-child.js'
import { memoryStoppedReason } from '../execution/memory-protection.js'
import * as memory from '../execution/process-memory.js'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
it.skipIf(process.platform === 'win32')(
  'saves a memory stop, transcript and paused queue; restart requires explicit recovery',
  async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const launcher = spawn(
      process.execPath,
      ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanups.push(() => stopOwnedChild(launcher))
    await once(launcher.stdout, 'data')
    let at = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => at)
    vi.spyOn(memory, 'readProcessMemory').mockImplementation(async () => ({
      total: 8 * 1024 ** 3,
      available: 128 * 1024 ** 2,
      pressure: true,
      processes:
        launcher.exitCode === null && launcher.signalCode === null
          ? [
              {
                pid: launcher.pid!,
                parent: process.pid,
                group: launcher.pid!,
                rss: 5 * 1024 ** 3,
                identity: 'owned-fixture',
              },
            ]
          : [],
    }))
    const options = {
      databasePath: join(f.directory, 'runtime.sqlite'),
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    }
    const runtime = await startRuntime(options)
    cleanups.push(() => runtime.close())
    const s = runtime.services
    s.store.update(() => f.workspace)
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const run = vi.fn<AgentAdapter['run']>(async (run) => {
      run.onOwnedProcess?.(launcher)
      run.onSession('saved-session')
      run.onText('Saved partial response')
      entered()
      try {
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(run.signal.reason)
          run.signal.addEventListener('abort', abort, { once: true })
          if (run.signal.aborted) abort()
        })
      } finally {
        await stopOwnedChild(launcher)
      }
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
    const task = s.tasks.create({
      title: 'Memory fixture',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    const execution = await s.tasks.start(task.id)
    const finished = execution.done.catch((error: unknown) => error)
    await ready
    await s.tasks.send(task.id, 'waiting-input', 'Keep this request queued')
    for (const step of [0, 5000, 10000, 15000]) {
      at += step === 0 ? 0 : 5000
      await s.tasks.memoryProtection.sample()
    }
    await finished
    expect(run).toHaveBeenCalledOnce()
    expect(s.store.task(task.id)).toMatchObject({
      status: 'cancelled',
      error: memoryStoppedReason,
      queuePaused: true,
      queue: [{ id: 'waiting-input' }],
      turns: [{ status: 'cancelled', error: memoryStoppedReason }],
    })
    expect(
      s.store
        .task(task.id)
        .messages.some((message) => message.text.includes('Saved partial response')),
    ).toBe(true)
    expect(s.store.task(task.id).restartRecovery).toBeUndefined()
    await runtime.close()
    cleanups.pop()
    const reopened = await startRuntime(options)
    cleanups.push(() => reopened.close())
    expect(reopened.services.store.task(task.id)).toMatchObject({
      status: 'cancelled',
      error: memoryStoppedReason,
      queuePaused: true,
      queue: [{ id: 'waiting-input' }],
    })
    const recover = vi.fn<AgentAdapter['run']>(async (run) => {
      run.onText('Recovered explicitly')
    })
    vi.spyOn(reopened.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: recover,
    })
    expect(recover).not.toHaveBeenCalled()
    await (
      await reopened.services.tasks.start(task.id)
    ).done
    expect(recover).toHaveBeenCalledOnce()
  },
)

it.skipIf(process.platform === 'win32')(
  'protects owned native children after the parent reply without a live task run',
  async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const launcher = spawn(
      process.execPath,
      ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanups.push(() => stopOwnedChild(launcher))
    await once(launcher.stdout, 'data')
    let at = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => at)
    vi.spyOn(memory, 'readProcessMemory').mockImplementation(async () => ({
      total: 8 * 1024 ** 3,
      available: 128 * 1024 ** 2,
      pressure: true,
      processes:
        launcher.exitCode === null && launcher.signalCode === null
          ? [
              {
                pid: launcher.pid!,
                parent: process.pid,
                group: launcher.pid!,
                rss: 5 * 1024 ** 3,
                identity: 'native-fixture',
              },
            ]
          : [],
    }))
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const s = runtime.services
    s.store.update(() => f.workspace)
    const stopped = vi.fn<() => Promise<void>>()
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        run.onOwnedProcess?.(launcher)
        run.onSession('native-session')
        stopped.mockImplementation(async () => {
          await stopOwnedChild(launcher)
          run.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
        })
        run.onNativeSession?.({ stop: stopped }, 'native-session')
        run.onSubagentEvent?.(
          'item/started',
          { threadId: 'native-child', item: { type: 'commandExecution' } },
          'native-session',
        )
        run.onText('Parent reply preserved')
      },
    })
    const task = s.tasks.create({
      title: 'Native memory fixture',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    await (
      await s.tasks.start(task.id)
    ).done
    expect(s.store.taskSummary(task.id).status).toBe('review')
    for (let step = 0; step < 4; step++) {
      if (step) at += 5000
      await s.tasks.memoryProtection.sample()
    }
    expect(stopped).toHaveBeenCalledOnce()
    expect(s.store.task(task.id)).toMatchObject({
      status: 'cancelled',
      queuePaused: true,
      error: memoryStoppedReason,
      turns: [{ status: 'completed' }],
    })
    expect(
      s.store
        .task(task.id)
        .messages.some((message) => message.text.includes('Parent reply preserved')),
    ).toBe(true)
  },
)
