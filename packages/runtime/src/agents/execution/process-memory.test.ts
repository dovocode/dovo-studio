import { expect, it } from 'vite-plus/test'
import {
  memoryBudget,
  ownedMemoryProcesses,
  parseMemoryProcesses,
  readProcessMemory,
} from './process-memory.js'

it('keeps a useful budget and headroom on small and large hosts', () => {
  const GiB = 1024 ** 3
  expect(memoryBudget(2 * GiB)).toEqual({ budget: GiB, headroom: 0.4 * GiB })
  expect(memoryBudget(8 * GiB)).toEqual({ budget: 4 * GiB, headroom: 1.6 * GiB })
  expect(memoryBudget(64 * GiB)).toEqual({ budget: 58 * GiB, headroom: 4 * GiB })
})
it('parses PID, parent, group, RSS and identity without collecting command lines', () => {
  const rows = parseMemoryProcesses(
    ' 10 1 10 2048 Fri Nov 13 10:00:00 2026\n11 10 11 4096 Fri Nov 13 10:01:00 2026\n12 11 11 512 Fri Nov 13 10:02:00 2026\n20 1 20 1024 Fri Nov 13 10:03:00 2026',
  )
  expect(ownedMemoryProcesses(rows[0]!, rows).map((row) => row.pid)).toEqual([10, 11, 12])
  expect(rows[0]!.rss).toBe(2048 * 1024)
  expect(() => parseMemoryProcesses('unavailable')).toThrow('unavailable')
})
it('rejects unsupported runtime enforcement instead of estimating', async () => {
  await expect(readProcessMemory('win32')).rejects.toThrow('unavailable')
})
it.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
  'reads real host pressure and identifies this process without large allocations',
  async () => {
    const snapshot = await readProcessMemory()
    expect(snapshot.total).toBeGreaterThan(0)
    expect(snapshot.available).toBeGreaterThanOrEqual(0)
    expect(snapshot.available).toBeLessThanOrEqual(snapshot.total)
    expect(snapshot.processes.find((row) => row.pid === process.pid)).toMatchObject({
      pid: process.pid,
      rss: expect.any(Number),
      identity: expect.any(String),
    })
  },
)
