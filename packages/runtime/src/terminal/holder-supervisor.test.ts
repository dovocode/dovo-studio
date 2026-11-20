/// <reference types="node" />
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vite-plus/test'
import {
  launchTerminalHolder,
  stopTerminalHolder,
  terminalHolderSupervisor,
} from './holder-supervisor'

const path = (name: string) => join(tmpdir(), name)
const node = path('node')
type Execute = (program: string, args: string[]) => Promise<string>

it('recognizes the explicit manager without treating an inherited service environment as managed', () => {
  expect(terminalHolderSupervisor({ INVOCATION_ID: 'fixture' }, 'linux')).toBeUndefined()
  expect(terminalHolderSupervisor({ DOVO_TERMINAL_HOLDER_SUPERVISOR: 'systemd' }, 'linux')).toBe(
    'systemd',
  )
  expect(terminalHolderSupervisor({ DOVO_TERMINAL_HOLDER_SUPERVISOR: 'launchd' }, 'darwin')).toBe(
    'launchd',
  )
  expect(
    terminalHolderSupervisor({ DOVO_TERMINAL_HOLDER_SUPERVISOR: 'launchd' }, 'linux'),
  ).toBeUndefined()
  expect(terminalHolderSupervisor({}, 'linux')).toBeUndefined()
  expect(terminalHolderSupervisor({}, 'darwin')).toBeUndefined()
})

it('gives each holder its own systemd unit that is independent of the runtime', async () => {
  const execute = vi.fn<Execute>(async () => '')
  const host = { node, execute }
  const helper = path('release & tools/holder $HOME.js')
  const directory = path('runtime % data/holder ${HOME}')
  await expect(launchTerminalHolder({ helper, directory }, 'systemd', host)).resolves.toBe(true)
  await launchTerminalHolder({ helper, directory: path('other profile/holder') }, 'systemd', host)
  await stopTerminalHolder(directory, 'systemd', host)
  const [[program, args], [, other], [stopper, stop]] = execute.mock.calls
  const unit = args[3].replace('--unit=', '')
  expect(unit).toMatch(/^dovo-terminal-holder-[a-f0-9]{24}\.service$/)
  expect(program).toBe('systemd-run')
  expect(args).toEqual([
    '--user',
    '--collect',
    '--quiet',
    `--unit=${unit}`,
    '--property=Type=exec',
    '--property=KillMode=control-group',
    '--',
    node,
    path('release & tools/holder $$HOME.js'),
    path('runtime % data/holder $${HOME}'),
  ])
  expect(other[3]).not.toEqual(args[3])
  expect(stopper).toBe('systemctl')
  expect(stop).toEqual(['--user', 'stop', unit])
})

it.skipIf(process.platform === 'win32')(
  'keeps the holder in its own private LaunchAgent without copying the runtime environment',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-holder & '))
    try {
      const helper = path('Studio & Tools/holder.js')
      const execute = vi.fn<Execute>(async (_program, args) => {
        if (args[0] === 'print') throw Object.assign(new Error('No such process'), { code: 113 })
        return ''
      })
      await expect(
        launchTerminalHolder({ helper, directory }, 'launchd', { node, uid: 501, execute }),
      ).resolves.toBe(true)
      const target = execute.mock.calls[0][1][1]
      expect(target).toMatch(/^gui\/501\/com\.dovo\.terminal-holder-[a-f0-9]{24}$/)
      const plist = join(directory, 'holder-launch-agent.plist')
      expect(execute.mock.calls).toEqual([
        ['/bin/launchctl', ['print', target]],
        ['/bin/launchctl', ['bootstrap', 'gui/501', plist]],
      ])
      const text = await readFile(plist, 'utf8')
      expect(text).toContain(`<key>Label</key><string>${target.split('/').at(-1)}</string>`)
      expect(text).toContain(helper.replaceAll('&', '&amp;'))
      expect(text).toContain(directory.replaceAll('&', '&amp;'))
      expect(text).not.toMatch(/EnvironmentVariables|KeepAlive|AbandonProcessGroup/)
      expect((await stat(plist)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it('leaves a running LaunchAgent alone and replaces one that has exited', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-holder-'))
  try {
    const helper = path('holder.js')
    const execute = vi.fn<Execute>(async () => '')
    const host = { node, uid: 501, execute }
    execute.mockResolvedValueOnce('state = running\n\tpid = 345\n')
    await expect(launchTerminalHolder({ helper, directory }, 'launchd', host)).resolves.toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
    const target = execute.mock.calls[0][1][1]
    execute.mockResolvedValueOnce('state = not running\n')
    await expect(launchTerminalHolder({ helper, directory }, 'launchd', host)).resolves.toBe(true)
    expect(execute.mock.calls.slice(1)).toEqual([
      ['/bin/launchctl', ['print', target]],
      ['/bin/launchctl', ['bootout', target]],
      ['/bin/launchctl', ['bootstrap', 'gui/501', join(directory, 'holder-launch-agent.plist')]],
    ])
    await stopTerminalHolder(directory, 'launchd', host)
    expect(execute.mock.calls.at(-1)).toEqual(['/bin/launchctl', ['bootout', target]])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('surfaces supervisor errors without falling back to a direct child', async () => {
  const failure = Object.assign(new Error('Supervisor timed out'), { killed: true })
  const execute = vi.fn<Execute>(async () => {
    throw failure
  })
  const location = { helper: path('holder.js'), directory: path('dovo-holder') }
  await expect(launchTerminalHolder(location, 'launchd', { node, uid: 501, execute })).rejects.toBe(
    failure,
  )
  await expect(launchTerminalHolder(location, 'systemd', { node, execute })).rejects.toBe(failure)
  expect(execute.mock.calls.map(([program]) => program)).toEqual(['/bin/launchctl', 'systemd-run'])
})
