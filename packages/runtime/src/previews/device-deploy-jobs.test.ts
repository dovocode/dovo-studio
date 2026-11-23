import { expect, it, vi } from 'vite-plus/test'
import type { DeviceDeployResult, DeviceDeployTarget } from '@dovo/protocol'
import { DeviceDeployJobs } from './device-deploy-jobs.js'

const scope = { taskId: 'thread', requestId: 'upgrade-1058' }
const input = {
  ...scope,
  action: 'start' as const,
  id: 'remote:mac:physical-ios:phone',
  revision: 'a'.repeat(40),
  buildNumber: 1058,
}
const status = { ...scope, action: 'status' as const, waitMs: 1000 }
const launched = { installed: true, launched: true, message: 'Installed and launched' }

it('recovers a lost start response without repeating deployment and scopes results to the run', async () => {
  const jobs = new DeviceDeployJobs()
  const deploy = vi
    .fn<(target: DeviceDeployTarget, signal: AbortSignal) => Promise<DeviceDeployResult>>()
    .mockResolvedValue(launched)
  expect(jobs.start(input, 'run-a', undefined, 'mac', deploy).status).toBe('running')
  expect(jobs.start(input, 'run-a', undefined, 'mac', deploy).status).toBe('running')
  await expect(jobs.follow(status, 'run-b')).rejects.toThrow('no longer available')
  expect(() =>
    jobs.start({ ...input, buildNumber: 1059 }, 'run-a', undefined, 'mac', deploy),
  ).toThrow('different deployment')
  await expect(jobs.follow(status, 'run-a')).resolves.toMatchObject({
    status: 'succeeded',
    ...launched,
  })
  expect(deploy).toHaveBeenCalledTimes(1)
})

it('cancels when the owning run ends and preserves a confirmed install if launch was interrupted', async () => {
  const jobs = new DeviceDeployJobs()
  const grant = new AbortController()
  const build = vi
    .fn<(target: DeviceDeployTarget, signal: AbortSignal) => Promise<DeviceDeployResult>>()
    .mockImplementation(async (_target, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return { installed: true, launched: false, message: 'Launch is unconfirmed' }
    })
  jobs.start(input, 'run-a', grant.signal, 'mac', build)
  await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
  grant.abort()
  await expect(jobs.follow(status, 'run-a')).resolves.toMatchObject({
    status: 'cancelled',
    installed: true,
    launched: false,
  })
})
