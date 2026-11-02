import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, agentSchema } from '@dovo/protocol'
import * as process from '../../../process.js'
import { requirePiVersion } from './pi-version.js'

vi.mock('../../../process.js', async (original) => ({
  ...(await original<typeof import('../../../process.js')>()),
}))
afterEach(() => vi.restoreAllMocks())

it('accepts the current T3-compatible Pi and identifies the legacy package when unsupported', async () => {
  const agent = decode(agentSchema, {
    id: 'pi',
    name: 'Pi',
    provider: 'pi',
    model: '',
    instructions: '',
    permission: 'read-only',
    endpoint: 'pi',
  })
  const exec = vi.spyOn(process, 'exec')
  exec.mockResolvedValueOnce({ stdout: '1.4.0\n', stderr: '' })
  await expect(requirePiVersion(agent)).resolves.toBeUndefined()
  exec.mockResolvedValueOnce({ stdout: '0.73.1\n', stderr: '' })
  await expect(requirePiVersion(agent)).rejects.toThrow('@earendil-works/pi-coding-agent 1.4')
})
