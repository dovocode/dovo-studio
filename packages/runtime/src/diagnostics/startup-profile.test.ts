import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startupProfile } from './startup-profile.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('is silent and does not create a timer unless explicitly enabled', () => {
  vi.stubEnv('DOVO_STARTUP_PROFILE', '')
  const uptime = vi.spyOn(process, 'uptime')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(startupProfile('runtime')).toBeUndefined()
  expect(uptime).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})

it('reports phase and process elapsed times when enabled', () => {
  vi.stubEnv('DOVO_STARTUP_PROFILE', '1')
  vi.spyOn(process, 'uptime').mockReturnValueOnce(2).mockReturnValueOnce(2.125)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  startupProfile('runtime')?.('database opened')
  expect(log).toHaveBeenCalledWith(
    '[dovo startup] runtime database opened: +125.0ms, total 2125.0ms',
  )
})
