import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { exec } from '../../process.js'
import { claudeAuthenticated } from './claude-command.js'

const mocks = vi.hoisted(() => ({ exec: vi.fn<typeof exec>() }))
vi.mock('../../process.js', async (original) => ({
  ...(await original<typeof import('../../process.js')>()),
  exec: mocks.exec,
  executableAvailable: async () => true,
}))
afterEach(() => mocks.exec.mockReset())

it.each([true, false])('requires the CLI to report authenticated=%s', async (loggedIn) => {
  mocks.exec.mockResolvedValue({ stdout: JSON.stringify({ loggedIn }), stderr: '' })
  expect(
    await claudeAuthenticated({
      provider: 'claude',
      endpoint: '/custom/claude',
      model: '',
      env: { CLAUDE_CONFIG_DIR: '/separate/account', ANTHROPIC_API_KEY: 'configured-key' },
    }),
  ).toBe(loggedIn)
  expect(mocks.exec).toHaveBeenCalledWith(
    '/custom/claude',
    ['auth', 'status', '--json'],
    expect.objectContaining({
      timeout: 5000,
      env: expect.objectContaining({
        CLAUDE_CONFIG_DIR: '/separate/account',
        ANTHROPIC_API_KEY: 'configured-key',
      }),
    }),
  )
})
it.each(['{}', 'not JSON', '{"loggedIn":"true"}'])(
  'does not infer a login from invalid output %s',
  async (stdout) => {
    mocks.exec.mockResolvedValue({ stdout, stderr: '' })
    expect(await claudeAuthenticated({ provider: 'claude', endpoint: '', model: '' })).toBe(false)
  },
)
it('keeps missing, signed-out or timed-out CLIs unavailable', async () => {
  mocks.exec.mockRejectedValue(new Error('Unavailable'))
  expect(await claudeAuthenticated({ provider: 'claude', endpoint: '', model: '' })).toBe(false)
})
