import { afterEach, expect, it, vi } from 'vitest'
import { SimulatorPreviews } from './simulators'
import * as native from './simulator-native'
import * as discovery from './devices'

afterEach(() => vi.restoreAllMocks())

it('merges waiting wheel input without crossing a tap or controller boundary', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const input = vi.fn<native.NativeSimulator['input']>().mockImplementationOnce(() => gate)
  vi.spyOn(native, 'iosSimulator').mockResolvedValue({
    input,
    start: () => () => {},
    release: async () => {},
    close: async () => {},
  })
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'qa',
    diagnostics: [],
    devices: [{ id: 'ios:qa', name: 'QA', platform: 'ios', state: 'booted', runtime: 'iOS' }],
  })
  const sessions = new SimulatorPreviews()
  const { id } = await sessions.open('task', 'ios:qa')
  const owner = vi.fn<() => void>(),
    other = vi.fn<() => void>()
  const scroll = { type: 'scroll' as const, x: 100, y: 200, deltaX: 0, deltaY: 10 }
  try {
    const first = sessions.input(id, scroll, owner)
    await vi.waitFor(() => expect(input).toHaveBeenCalledOnce())
    const waiting = Array.from({ length: 120 }, () => sessions.input(id, scroll, owner))
    const tap = {
      type: 'pointer' as const,
      phase: 'down' as const,
      x: 100,
      y: 200,
      button: 'left' as const,
    }
    waiting.push(sessions.input(id, tap, owner))
    waiting.push(sessions.input(id, scroll, owner))
    waiting.push(sessions.input(id, scroll, other))
    release()
    await Promise.all([first, ...waiting])
    expect(input.mock.calls.map(([value]) => value)).toEqual([
      scroll,
      { ...scroll, deltaY: 1200 },
      tap,
      scroll,
      scroll,
    ])
    expect(owner).toHaveBeenCalledTimes(4)
    expect(other).toHaveBeenCalledOnce()
  } finally {
    release()
    await sessions.close(id)
  }
})
