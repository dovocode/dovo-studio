import { expect, it } from 'vite-plus/test'
import { windowsAsrGuidance } from './windows-runtime'

it('interprets the exact ASR rule, including uppercase and braced identifiers', () => {
  expect(windowsAsrGuidance('{9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2}')).toContain(
    'without stopping it',
  )
  expect(windowsAsrGuidance('d1e49aac-8f56-4280-b9ba-993a6d77406c')).toContain('WMI or PsExec')
  expect(windowsAsrGuidance('01443614-cd74-433a-b99e-2ecdc07bfc25')).toContain(
    'trust or reputation',
  )
  expect(windowsAsrGuidance('unknown-rule')).toContain('investigate')
  expect(windowsAsrGuidance('svchost.exe')).not.toContain('LSASS')
})

it('removes Electron and FiberFailure transport prefixes from visible errors', async () => {
  const { windowsRuntimeErrorMessage } = await import('./windows-runtime')
  expect(
    windowsRuntimeErrorMessage(
      new Error(
        "Error invoking remote method 'runtime:windows-save': (FiberFailure) Error: WSL localhost forwarding is unavailable",
      ),
    ),
  ).toBe('WSL localhost forwarding is unavailable')
})
