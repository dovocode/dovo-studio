import { afterEach, expect, it, vi } from 'vitest'
import { defaultShell, shellArguments } from './shell'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
it('uses PowerShell without POSIX login flags for automatic Windows terminals', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('SystemRoot', 'C:/Windows')
  expect(defaultShell()).toMatch(/WindowsPowerShell.*powershell.exe$/)
  expect(shellArguments({ shell: '', shellArgs: ['-l'] })).toEqual(['-NoLogo', '-NoProfile'])
  expect(shellArguments({ shell: 'bash.exe', shellArgs: ['-l'] })).toEqual(['-l'])
})
