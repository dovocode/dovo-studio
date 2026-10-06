import { afterEach, expect, it, vi } from 'vite-plus/test'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import {
  parseWindowsSecurityResult,
  readWindowsSecurity,
  windowsSecurityScript,
} from './windows-security'

const run = vi.hoisted(() =>
  vi.fn<
    (file: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>
  >(),
)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execute = vi.fn<typeof actual.execFile>()
  Object.defineProperty(execute, promisify.custom, { value: run })
  return { ...actual, execFile: execute }
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  run.mockReset()
})
const event = {
  timeCreated: '2026-10-06T10:00:00.0000000Z',
  ruleId: '9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2',
  processPath: 'C:\\Windows\\System32\\svchost.exe',
  targetPath: 'C:\\Windows\\System32\\lsass.exe',
}

it('reads bounded structured events, preserving Unicode paths and unknown rule IDs', () => {
  const events = [event, { ...event, ruleId: 'unknown', targetPath: 'C:\\Users\\Zoë\\项目.exe' }]
  expect(parseWindowsSecurityResult('\uFEFF' + JSON.stringify({ status: 'ok', events }))).toEqual({
    status: 'ok',
    events,
  })
  expect(parseWindowsSecurityResult('{"status":"ok","events":[]}')).toEqual({
    status: 'ok',
    events: [],
  })
})
it('rejects malformed reports instead of claiming the log has no blocks', () => {
  for (const value of [
    'not-json',
    JSON.stringify({ status: 'ok', events: null }),
    JSON.stringify({ status: 'ok', events: [{ ...event, ruleId: 1121 }] }),
    JSON.stringify({ status: 'ok', events: Array.from({ length: 21 }, () => event) }),
  ])
    expect(() => parseWindowsSecurityResult(value)).toThrow(/./)
})
it('queries the system PowerShell without profiles, elevation or policy changes', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  run.mockResolvedValue({ stdout: JSON.stringify({ status: 'ok', events: [event] }), stderr: '' })
  expect(await readWindowsSecurity()).toMatchObject({ status: 'ok', events: [event] })
  expect(run).toHaveBeenCalledWith(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSecurityScript],
    expect.objectContaining({ timeout: 10000, windowsHide: true, encoding: 'utf8' }),
  )
})
it('distinguishes log access denial from a successful empty query', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  run.mockResolvedValue({ stdout: '{"status":"access-denied","events":[]}', stderr: '' })
  expect(await readWindowsSecurity()).toMatchObject({ status: 'access-denied', events: [] })
})
it('reports launch failures and invalid output without exposing stderr or credentials', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  run
    .mockRejectedValueOnce(new Error('sensitive-command-line'))
    .mockResolvedValueOnce({ stdout: 'invalid-json', stderr: 'private-token' })
  for (let index = 0; index < 2; index++) {
    const report = await readWindowsSecurity()
    expect(report).toMatchObject({ status: 'unavailable', events: [] })
    expect(JSON.stringify(report)).not.toMatch(/sensitive|private/)
  }
})
it.runIf(process.platform === 'win32')(
  'parses the actual PowerShell event XML with localized paths',
  async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const execute = promisify(actual.execFile)
    const { stdout } = await execute(
      win32.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
function Get-WinEvent {
  $record = [PSCustomObject]@{ TimeCreated = [DateTime]::UtcNow }
  $record | Add-Member -MemberType ScriptMethod -Name ToXml -Value {
    '<Event><EventData><Data Name="ID">9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2</Data><Data Name="Process Name">C:\\Windows\\System32\\svchost.exe</Data><Data Name="Path">C:\\Users\\Zoë\\项目.exe</Data><Data Name="User">private-user</Data><Data Name="Target Commandline">private-token</Data></EventData></Event>'
  }
  $record
}
${windowsSecurityScript}`,
      ],
      { windowsHide: true, timeout: 10000, encoding: 'utf8' },
    )
    const result = parseWindowsSecurityResult(stdout)
    expect(result).toMatchObject({
      status: 'ok',
      events: [
        {
          ruleId: event.ruleId,
          processPath: event.processPath,
          targetPath: 'C:\\Users\\Zoë\\项目.exe',
        },
      ],
    })
    expect(stdout).not.toMatch(/private-user|private-token/)
  },
  // Include cold PowerShell startup and keep the test deadline beyond the
  // subprocess's own 10-second timeout, which still bounds a stalled query.
  15_000,
)
