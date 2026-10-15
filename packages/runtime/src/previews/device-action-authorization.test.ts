import { afterEach, expect, it, vi } from 'vite-plus/test'
const commands = vi.hoisted(() => ({
  run: vi.fn<
    (file: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>
  >(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: commands.run }),
}))
vi.mock('node:fs/promises', async (original) => {
  const files = await original<typeof import('node:fs/promises')>()
  return { ...files, access: vi.fn<typeof files.access>().mockResolvedValue(undefined) }
})
import { openDatabase } from '../storage/database'
import { DeviceHosts } from './device-hosts'
import * as native from './simulator-native'
afterEach(() => {
  vi.restoreAllMocks()
  commands.run.mockReset()
})

it.each(['abort', 'revoke', 'cleanup'] as const)(
  'does not shut down a local emulator after %s during discovery',
  async (mode) => {
    const db = openDatabase(':memory:')
    const manager = new DeviceHosts(db, async () => {})
    manager.settings.save({ enabled: true, hosts: [] })
    const controller = new AbortController()
    let revoked = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(native, 'emulatorEndpoint').mockResolvedValue({ address: 'localhost:8554', token: '' })
    commands.run.mockImplementation(async (_file, args) => {
      let stdout = ''
      if (args[0] === '-list-avds') {
        await gate
        stdout = 'test'
      } else if (args[0] === 'devices') stdout = 'emulator-5554 device'
      else if (args.includes('name')) stdout = 'test'
      else if (args.includes('sys.boot_completed')) stdout = '1'
      return { stdout, stderr: '' }
    })
    const pending = manager
      .action(
        { taskId: 'task', id: 'android:test', action: 'shutdown' },
        true,
        controller.signal,
        () => {
          if (revoked) throw new Error('Credential revoked')
        },
      )
      .catch((error: unknown) => error)
    try {
      await vi.waitFor(() =>
        expect(commands.run.mock.calls.some(([, args]) => args[0] === '-list-avds')).toBe(true),
      )
      if (mode === 'abort') controller.abort()
      else if (mode === 'revoke') revoked = true
      else await manager.closeTask('task')
      release()
      expect(await pending).toMatchObject({
        message: expect.stringMatching(/aborted|revoked|cancelled/),
      })
      expect(commands.run.mock.calls.some(([, args]) => args.includes('kill'))).toBe(false)
    } finally {
      release()
      await pending
      await manager.dispose()
      db.close()
    }
  },
)
