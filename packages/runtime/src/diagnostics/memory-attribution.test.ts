import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  childProcessMemory,
  expensiveRequestName,
  MemoryAttribution,
  type MemoryReadings,
} from './memory-attribution'

const MB = 1024 * 1024
function fakeReadings() {
  const state = { heap: 100 * MB, external: 10 * MB, now: Date.parse('2026-10-30T10:00:00Z') }
  const readings: MemoryReadings = {
    heapUsed: () => state.heap,
    heapLimit: () => 4096 * MB,
    external: () => state.external,
    arrayBuffers: () => state.external / 2,
    rss: () => state.heap * 2,
    now: () => state.now,
  }
  return { state, readings }
}

describe('MemoryAttribution', () => {
  it('records only substantial or slow operations in a bounded recent buffer', async () => {
    const { state, readings } = fakeReadings()
    const memory = new MemoryAttribution(readings, () => {})
    memory.measure('tiny', () => {
      state.heap += MB
    })
    await memory.measure('history page', async () => {
      state.heap += 20 * MB
    })
    memory.measure('slow file read', () => {
      state.now += 1_500
    })
    expect(() =>
      memory.measure('failed diff', () => {
        state.heap += 30 * MB
        throw new Error('git failed')
      }),
    ).toThrow('git failed')
    for (let index = 0; index < 40; index++)
      memory.measure(`snapshot ${index}`, () => {
        state.heap += 10 * MB
      })
    const report = await memory.report(async () => null)
    expect(report.recent).toHaveLength(32)
    expect(report.recent[0]).toMatchObject({ name: 'snapshot 39', heapGrowthBytes: 10 * MB })
    expect(report.recent.map((operation) => operation.name)).not.toContain('tiny')
    expect(report.children).toBeNull()
  })

  it('names suspects within the window once per cooldown and warns with the caveat', async () => {
    const { state, readings } = fakeReadings()
    const warn = vi.fn<(message: string) => void>()
    const memory = new MemoryAttribution(readings, warn)
    const longTurn = memory.begin('long-running stream')
    for (let index = 0; index < 20; index++) {
      state.now += 1000
      memory.sample()
    }
    const snapshot = memory.begin('snapshot')
    memory.measure('diff', () => {
      state.heap += 60 * MB
    })
    state.heap += 90 * MB
    memory.sample()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('approximate')
    const [spike] = (await memory.report(async () => null)).spikes
    expect(spike).toMatchObject({ growthBytes: 150 * MB, concurrentOperations: 2 })
    // The long stream opened before the window would otherwise claim all of the growth.
    expect(spike!.suspects).toEqual([
      { name: 'snapshot', heapGrowthBytes: 150 * MB, running: true },
      { name: 'diff', heapGrowthBytes: 60 * MB, running: false },
    ])
    state.heap += 200 * MB
    memory.sample()
    expect(warn).toHaveBeenCalledTimes(1)
    snapshot()
    longTurn()
    longTurn()
  })

  it('stops sampling and forgets operations on dispose', async () => {
    vi.useFakeTimers()
    try {
      const { state, readings } = fakeReadings()
      const warn = vi.fn<(message: string) => void>()
      const memory = new MemoryAttribution(readings, warn)
      memory.start(1_000)
      const end = memory.begin('snapshot')
      memory.dispose()
      state.heap += 500 * MB
      end()
      vi.advanceTimersByTime(20_000)
      expect(warn).not.toHaveBeenCalled()
      expect((await memory.report(async () => null)).recent).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('classifies only the expensive snapshot, history, diff and file endpoints', () => {
    expect(expensiveRequestName('GET', '/api/snapshot')).toBe('snapshot')
    expect(expensiveRequestName('POST', '/api/tasks/history')).toBe('history page')
    expect(expensiveRequestName('POST', '/api/scm/changes')).toBe('diff')
    expect(expensiveRequestName('POST', '/api/tasks/files/read')).toBe('file read')
    expect(expensiveRequestName('POST', '/api/snapshot')).toBeUndefined()
    expect(expensiveRequestName('POST', '/api/tasks/message')).toBeUndefined()
    expect(expensiveRequestName('POST', '/api/tasks/files/search-content')).toBe(
      'file content search',
    )
    expect(expensiveRequestName('POST', '/api/tasks/commits/changes')).toBe('commit diff')
  })
})

describe('childProcessMemory', () => {
  it('sums resident memory of descendants only, and reports other platforms as unavailable', async () => {
    const proc = await mkdtemp(join(tmpdir(), 'dovo-proc-'))
    try {
      const process = async (pid: number, children: Record<string, string>, rssKb?: number) => {
        for (const [task, list] of Object.entries(children)) {
          await mkdir(join(proc, String(pid), 'task', task), { recursive: true })
          await writeFile(join(proc, String(pid), 'task', task, 'children'), list)
        }
        await writeFile(
          join(proc, String(pid), 'status'),
          `Name:\tx\n${rssKb === undefined ? '' : `VmRSS:\t   ${rssKb} kB\n`}`,
        )
      }
      await process(10, { '10': '11 ', '12': '13' })
      await process(11, { '11': '14' }, 1000)
      await process(13, { '13': '' }, 2000)
      await process(14, { '14': '' })
      // An unrelated process is never read.
      await process(99, { '99': '' }, 999_999)
      expect(await childProcessMemory(10, proc, 'linux')).toEqual({
        processes: 3,
        rssBytes: 3000 * 1024,
        truncated: false,
      })
      expect(await childProcessMemory(10, proc, 'darwin')).toBeNull()
      expect(await childProcessMemory(404, proc, 'linux')).toBeNull()
    } finally {
      await rm(proc, { recursive: true, force: true })
    }
  })
})

describe('buffer memory and idle monitoring', () => {
  it('reports external buffers separately and detects growth outside the JavaScript heap', async () => {
    const { state, readings } = fakeReadings()
    const warn = vi.fn<(message: string) => void>()
    const memory = new MemoryAttribution(readings, warn)
    memory.sample()
    state.now += 1000
    state.external += 150 * MB
    memory.sample()
    const report = await memory.report(async () => null)
    expect(report.externalBytes).toBe(160 * MB)
    expect(report.arrayBufferBytes).toBe(80 * MB)
    expect(report.spikes).toHaveLength(1)
    expect(report.spikes[0]).toMatchObject({
      growthBytes: 0,
      externalGrowthBytes: 150 * MB,
      suspects: [],
    })
    expect(warn.mock.calls[0]?.[0]).toContain('external +150 MB')
    expect(report.gc).toEqual({ collections: 0, durationMs: 0 })
    expect(report.eventLoopUtilization).toBeGreaterThanOrEqual(0)
    expect(report.eventLoopUtilization).toBeLessThanOrEqual(1)
    memory.dispose()
  })
  it('samples slowly while idle, promptly during expensive work, and releases its timer on disposal', () => {
    vi.useFakeTimers()
    const { readings } = fakeReadings()
    const sample = vi.spyOn(readings, 'heapUsed')
    const memory = new MemoryAttribution(readings, () => {})
    try {
      memory.start()
      expect(sample).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(9000)
      expect(sample).toHaveBeenCalledTimes(1)
      const done = memory.begin('diff')
      const activeStart = sample.mock.calls.length
      vi.advanceTimersByTime(3000)
      expect(sample.mock.calls.length - activeStart).toBe(3)
      done()
      const idleStart = sample.mock.calls.length
      vi.advanceTimersByTime(9000)
      expect(sample.mock.calls.length).toBe(idleStart + 1) // Finish one pending active sample.
      vi.advanceTimersByTime(1000)
      expect(sample.mock.calls.length).toBe(idleStart + 1)
      memory.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      memory.dispose()
      vi.useRealTimers()
    }
  })
})

it('detects idle memory growth when the timer fires later than the nominal window', async () => {
  const { state, readings } = fakeReadings()
  const memory = new MemoryAttribution(readings, () => {})
  memory.sample()
  state.now += 10_050
  state.external += 150 * MB
  memory.sample()
  expect((await memory.report(async () => null)).spikes[0]?.externalGrowthBytes).toBe(150 * MB)
  memory.dispose()
})
it('keeps a useful sampling window without resetting timers on every streamed delta', async () => {
  vi.useFakeTimers()
  const { state, readings } = fakeReadings()
  const warn = vi.fn<(message: string) => void>()
  const memory = new MemoryAttribution(readings, warn)
  const samples = vi.spyOn(memory, 'sample')
  const timers = vi.spyOn(globalThis, 'setTimeout')
  try {
    memory.start()
    for (let index = 0; index < 100; index++) {
      state.now += 100
      vi.advanceTimersByTime(100)
      memory.measure('sync delta', () => {
        state.heap += 2 * MB
      })
    }
    expect(samples.mock.calls.length).toBeLessThanOrEqual(12)
    expect(timers.mock.calls.length).toBeLessThanOrEqual(22) // At most two per sampling interval, not per delta.
    expect(warn).toHaveBeenCalledTimes(1)
    expect((await memory.report(async () => null)).spikes[0]?.growthBytes).toBeGreaterThanOrEqual(
      128 * MB,
    )
  } finally {
    memory.dispose()
    timers.mockRestore()
    vi.useRealTimers()
  }
})
