import { expect, it, vi } from 'vite-plus/test'
import type { Profiler } from 'node:inspector'
import {
  FreezeProfiles,
  summarizeCpuProfile,
  captureFreezeProfile,
  type FreezeProfile,
} from './freeze-profiles.js'

it('retains bounded function counts without user names, URLs or source paths', () => {
  const node = (id: number, url: string, functionName: string): Profiler.ProfileNode => ({
    id,
    callFrame: { functionName, scriptId: String(id), url, lineNumber: 0, columnNumber: 0 },
  })
  const summary = summarizeCpuProfile({
    startTime: 0,
    endTime: 2000000,
    nodes: [
      node(1, new URL('memory-attribution.ts', import.meta.url).href, 'sample'),
      node(2, 'file:///home/private/customer-secret.js', 'privateFunctionWithSecret'),
      node(3, 'node:fs', 'readFile'),
      node(4, 'file://%invalid', 'secret'),
    ],
    samples: [1, 1, 2, 3],
  })
  expect(summary).toMatchObject({
    durationMs: 2000,
    samples: 4,
    functions: [
      { name: 'sample', samples: 2 },
      { name: '[other JavaScript]', samples: 1 },
      { name: '[node]', samples: 1 },
    ],
  })
  expect(JSON.stringify(summary)).not.toMatch(/private|customer|file:|\/home\//)
})

it('captures a real local inspector profile and keeps only bounded summaries', async () => {
  const controller = new AbortController()
  const capture = captureFreezeProfile(controller.signal)
  const until = performance.now() + 80
  let value = 0
  while (performance.now() < until) value += Math.sqrt(performance.now())
  expect(value).toBeGreaterThan(0)
  const profile = await capture
  expect(profile.durationMs).toBeGreaterThan(100)
  expect(profile.samples).toBeGreaterThan(0)
  expect(profile.functions.length).toBeLessThanOrEqual(10)
  expect(JSON.stringify(profile)).not.toMatch(/file:|scriptId|callFrame|\/home\//)
})

it('requires opt-in and repeated busy stalls, then enforces cooldown and disposal', async () => {
  let enabled = false,
    now = 100000
  const collect = vi.fn<() => Promise<FreezeProfile>>(async () => ({
    at: new Date(now).toISOString(),
    durationMs: 2000,
    samples: 1,
    functions: [],
  }))
  const profiles = new FreezeProfiles(
    () => enabled,
    collect,
    () => now,
  )
  profiles.sample(900, 0.99)
  profiles.sample(900, 0.99)
  expect(collect).not.toHaveBeenCalled()
  enabled = true
  profiles.sample(900, 0.1)
  profiles.sample(900, 0.99)
  expect(collect).not.toHaveBeenCalled()
  profiles.sample(900, 0.99)
  await Promise.resolve()
  await Promise.resolve()
  expect(collect).toHaveBeenCalledOnce()
  expect(profiles.snapshot().profiles).toHaveLength(1)
  profiles.sample(900, 0.99)
  profiles.sample(900, 0.99)
  expect(collect).toHaveBeenCalledOnce()
  now += 600001
  profiles.sample(900, 0.99)
  profiles.sample(900, 0.99)
  await Promise.resolve()
  await Promise.resolve()
  expect(collect).toHaveBeenCalledTimes(2)
  profiles.dispose()
  expect(profiles.snapshot().profiles).toEqual([])
})
