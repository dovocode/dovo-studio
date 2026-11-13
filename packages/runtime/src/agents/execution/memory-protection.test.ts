import { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { MemoryProtection, MemoryPressureStop, memoryStoppedReason } from './memory-protection.js'
import type { MemoryOwner } from './memory-protection.js'
import type { ProcessMemory, MemoryProcess } from './process-memory.js'

const GiB = 1024 ** 3
const guards: MemoryProtection[] = []
afterEach(async () => {
  for (const guard of guards.splice(0)) await guard.dispose()
  vi.useRealTimers()
})
function child(pid: number) {
  const result = new ChildProcess()
  Object.assign(result, { pid })
  return result
}
function row(pid = 100, rss = 5 * GiB): MemoryProcess {
  return { pid, parent: 1, group: pid, rss, identity: `start-${pid}` }
}
function setup(platform: NodeJS.Platform = 'linux') {
  let at = 0
  const snapshot: ProcessMemory = { total: 8 * GiB, available: 0.2 * GiB, processes: [row()] }
  const read = vi.fn<() => Promise<ProcessMemory>>(async () => structuredClone(snapshot))
  const release = vi.fn<() => Promise<void>>(async () => {})
  const shutdown = vi.fn<(process: ChildProcess) => Promise<void>>(async (process) => {
    snapshot.processes = snapshot.processes.filter((row) => row.group !== process.pid)
  })
  const guard = new MemoryProtection(read, release, () => at, shutdown, platform)
  guards.push(guard)
  const stop = vi.fn<(reason: MemoryPressureStop) => void>()
  const owner: MemoryOwner = { taskId: 'task', runId: 'run', current: () => true, stop }
  const own = guard.begin(owner)
  own(child(100))
  const sample = async (time: number) => {
    at = time
    await guard.sample()
  }
  const dangerous = async () => {
    for (const time of [0, 5000, 10000, 15000]) await sample(time)
  }
  return { snapshot, read, release, shutdown, guard, stop, own, owner, sample, dangerous }
}
it('releases idle first and requires a new sustained window before stopping one owned run', async () => {
  const t = setup()
  await t.sample(0)
  expect(t.release).toHaveBeenCalledOnce()
  expect(t.stop).not.toHaveBeenCalled()
  await t.sample(5000)
  await t.sample(10000)
  expect(t.stop).not.toHaveBeenCalled()
  await t.sample(15000)
  expect(t.stop).toHaveBeenCalledWith(expect.any(MemoryPressureStop))
  expect(t.shutdown).toHaveBeenCalledOnce()
  expect(t.guard.report().lastStop).toMatchObject({
    taskId: 'task',
    runId: 'run',
    reason: memoryStoppedReason,
  })
  await t.sample(20000)
  expect(t.stop).toHaveBeenCalledOnce()
})
it('requires machine pressure and a substantial owned budget, excluding shared provider memory', async () => {
  const t = setup()
  t.snapshot.processes.push(row(900, 20 * GiB)) // Shared server: never registered.
  t.snapshot.processes[0]!.rss = 0.1 * GiB
  await t.dangerous()
  expect(t.stop).not.toHaveBeenCalled()
  expect(t.guard.report().ownedRssBytes).toBe(0.1 * GiB)
  t.snapshot.processes[0]!.rss = 5 * GiB
  t.snapshot.available = 3 * GiB
  await t.dangerous()
  expect(t.stop).not.toHaveBeenCalled()
})
it('does not treat normal macOS kernel pressure as danger despite low free memory', async () => {
  const t = setup('darwin')
  t.snapshot.pressure = false
  await t.dangerous()
  expect(t.release).not.toHaveBeenCalled()
  expect(t.stop).not.toHaveBeenCalled()
  t.snapshot.pressure = true
  await t.dangerous()
  expect(t.stop).toHaveBeenCalledOnce()
})
it('reports shared or SDK-managed runs as uncovered and never stops them', async () => {
  const t = setup()
  const stop = vi.fn<MemoryOwner['stop']>()
  t.guard.begin({ taskId: 'shared', runId: 'shared-run', current: () => true, stop })
  await t.dangerous()
  expect(stop).not.toHaveBeenCalled()
  expect(t.guard.report().runs).toContainEqual({
    taskId: 'shared',
    runId: 'shared-run',
    mode: 'unavailable',
  })
})
it('rebinds warm launchers and rejects an old run callback', async () => {
  const t = setup()
  const warm = child(100)
  t.own(warm)
  const stop = vi.fn<MemoryOwner['stop']>()
  const own = t.guard.begin({ ...t.owner, runId: 'next', stop })
  own(warm)
  t.own(warm) // Late callback from the previous attempt must not steal ownership.
  await t.dangerous()
  expect(t.stop).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalledOnce()
  expect(t.guard.report().lastStop?.runId).toBe('next')
})
it('rejects a reused process identity and exited launchers', async () => {
  const t = setup()
  const process = child(100)
  t.own(process)
  await t.sample(0)
  t.snapshot.processes[0]!.identity = 'reused'
  await t.sample(5000)
  await t.sample(10000)
  await t.sample(15000)
  expect(t.stop).not.toHaveBeenCalled()
  Object.assign(process, { exitCode: 0 })
  await t.sample(20000)
  expect(t.guard.report().ownedRuns).toBe(0)
})
it('rechecks the current run and memory after asynchronous sampling', async () => {
  const t = setup()
  await t.sample(0)
  await t.sample(5000)
  await t.sample(10000)
  t.read.mockImplementationOnce(async () => structuredClone(t.snapshot))
  t.read.mockImplementationOnce(async () => {
    t.guard.begin({ ...t.owner, runId: 'new-run' })
    return structuredClone(t.snapshot)
  })
  await t.sample(15000)
  expect(t.stop).not.toHaveBeenCalled()
  expect(t.shutdown).not.toHaveBeenCalled()
})
it('does not stop on a stale RSS budget if fresh readings recover', async () => {
  const t = setup()
  await t.sample(0)
  await t.sample(5000)
  await t.sample(10000)
  t.read.mockImplementationOnce(async () => structuredClone(t.snapshot))
  t.read.mockImplementationOnce(async () => ({
    ...structuredClone(t.snapshot),
    available: 3 * GiB,
  }))
  await t.sample(15000)
  expect(t.stop).not.toHaveBeenCalled()
})
it('breaks the pressure window on unavailable readings or host suspension', async () => {
  const t = setup()
  await t.sample(0)
  await t.sample(5000)
  t.read.mockRejectedValueOnce(new Error('Memory source is unavailable'))
  await t.sample(10000)
  expect(t.guard.report()).toMatchObject({
    mode: 'unavailable',
    detail: 'Memory source is unavailable',
  })
  await t.sample(15000)
  await t.sample(20000)
  await t.sample(50000)
  expect(t.stop).not.toHaveBeenCalled()
})
it('does not cascade to other runs when cleanup fails or escaped descendants survive', async () => {
  const t = setup()
  t.snapshot.processes.push({ ...row(101, GiB), parent: 100, group: 101 })
  const another = {
    ...t.owner,
    taskId: 'other',
    runId: 'other-run',
    stop: vi.fn<MemoryOwner['stop']>(),
  }
  const other = child(200)
  t.snapshot.processes.push(row(200, 5 * GiB))
  t.guard.begin(another)(other)
  await t.dangerous()
  expect(t.guard.report().mode).toBe('unavailable')
  expect(t.stop).toHaveBeenCalledOnce()
  for (const time of [20000, 25000, 30000, 35000]) await t.sample(time)
  expect(another.stop).not.toHaveBeenCalled()
  expect(t.shutdown).toHaveBeenCalledOnce()
  expect(t.guard.report().mode).toBe('unavailable')
  t.snapshot.available = 3 * GiB
  await t.sample(40000)
  t.snapshot.available = 0.2 * GiB
  for (const time of [45000, 50000, 55000, 60000]) await t.sample(time)
  expect(another.stop).toHaveBeenCalledOnce()
})
it('stops every registered dedicated tree of the selected run', async () => {
  const t = setup()
  t.snapshot.processes.push(row(101, GiB))
  t.own(child(101))
  await t.dangerous()
  expect(t.shutdown).toHaveBeenCalledTimes(2)
  expect(t.stop).toHaveBeenCalledOnce()
})
it('uses the whole run RSS when its first registered tree is small', async () => {
  const t = setup()
  t.snapshot.processes[0]!.rss = 100 * 1024 ** 2
  t.snapshot.processes.push(row(101, 6 * GiB))
  t.own(child(101))
  await t.dangerous()
  expect(t.stop).toHaveBeenCalledOnce()
  expect(t.shutdown).toHaveBeenCalledTimes(2)
})
it('counts overlapping trees once per owner when selecting the largest run', async () => {
  const t = setup()
  t.snapshot.processes[0]!.rss = GiB
  t.snapshot.processes.push({ ...row(101, 2 * GiB), parent: 100 })
  t.own(child(101))
  const stop = vi.fn<MemoryOwner['stop']>()
  const larger = child(200)
  t.snapshot.processes.push(row(200, 4 * GiB))
  t.guard.begin({ taskId: 'larger', runId: 'larger-run', current: () => true, stop })(larger)
  await t.dangerous()
  expect(t.guard.report().ownedRssBytes).toBe(7 * GiB)
  expect(t.stop).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalledOnce()
  expect(t.shutdown).toHaveBeenCalledExactlyOnceWith(larger)
})
it('still cleans up the owned process if cancellation persistence fails', async () => {
  const t = setup()
  t.stop.mockImplementation(() => {
    throw new Error('Disk write failed')
  })
  await t.dangerous()
  expect(t.shutdown).toHaveBeenCalledOnce()
  expect(t.guard.report()).toMatchObject({ mode: 'unavailable', detail: 'Disk write failed' })
})
it('does not stop active work after idle provider cleanup fails', async () => {
  const t = setup()
  t.release.mockRejectedValue(new Error('Idle shutdown is unconfirmed'))
  await t.dangerous()
  expect(t.stop).not.toHaveBeenCalled()
  expect(t.guard.report().mode).toBe('unavailable')
})
it('reports Windows enforcement unavailable without sampling or signalling', async () => {
  const t = setup('win32')
  await t.dangerous()
  expect(t.read).not.toHaveBeenCalled()
  expect(t.stop).not.toHaveBeenCalled()
  expect(t.guard.report()).toMatchObject({ mode: 'unavailable', uncoveredRuns: 1 })
})
it('disposes its timer and rejects late registrations and samples; a fresh instance starts clean', async () => {
  vi.useFakeTimers()
  const t = setup()
  expect(vi.getTimerCount()).toBe(1)
  await t.guard.dispose()
  t.own(child(200))
  await t.guard.sample()
  expect(vi.getTimerCount()).toBe(0)
  expect(t.read).not.toHaveBeenCalled()
  const next = setup()
  await next.sample(0)
  expect(next.guard.report().lastStop).toBeUndefined()
})

it('waits for an in-flight sample on dispose without acting on its late result', async () => {
  const t = setup()
  let finish!: (snapshot: ProcessMemory) => void
  t.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const sampling = t.guard.sample()
  const disposed = t.guard.dispose()
  finish(structuredClone(t.snapshot))
  await Promise.all([sampling, disposed])
  expect(t.stop).not.toHaveBeenCalled()
  expect(t.shutdown).not.toHaveBeenCalled()
})
