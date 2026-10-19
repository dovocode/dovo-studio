import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../index'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.unstubAllEnvs()
})
it('registers only the authenticated device, excludes tokens from snapshots and activity, and removes registration independently', async () => {
  vi.stubEnv('DOVO_NOTIFICATION_RELAY_URL', 'http://127.0.0.1:1')
  vi.stubEnv('DOVO_NOTIFICATION_RELAY_TOKEN', 'relay-secret-at-least-thirty-two-characters')
  const ownerToken = randomBytes(32).toString('hex')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  const phoneToken = randomBytes(32).toString('hex')
  const phone = runtime.services.devices.add('Phone', phoneToken)
  const registration = {
    runtimeId: 'phone-profile',
    platform: 'ios',
    token: randomBytes(32).toString('hex'),
    environment: 'sandbox',
  }
  const call = (path: string, token: string, input?: object) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/notifications/${path}`, {
      method: input ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    })
  expect((await call('register', 'invalid', registration)).status).toBe(401)
  expect((await call('register', phoneToken, registration)).status).toBe(200)
  expect(await (await call('status', phoneToken)).json()).toMatchObject({
    configured: true,
    registered: true,
  })
  expect(await (await call('status', ownerToken)).json()).toMatchObject({ registered: false })
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(
    registration.token,
  )
  expect(JSON.stringify(runtime.services.store.get())).not.toContain(registration.token)
  expect((await call('remove', ownerToken, {})).status).toBe(200)
  expect(runtime.services.pushNotifications.status(phone).registered).toBe(true)
  expect((await call('remove', phoneToken, {})).status).toBe(200)
  expect(runtime.services.pushNotifications.status(phone).registered).toBe(false)
})

it('accepts a scoped managed credential only through paired-device authentication, without host relay settings', async () => {
  vi.stubEnv('DOVO_NOTIFICATION_RELAY_URL', '')
  vi.stubEnv('DOVO_NOTIFICATION_RELAY_TOKEN', '')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: 'owner', port: 0 })
  cleanups.push(runtime.close)
  const deviceToken = randomBytes(32).toString('hex')
  runtime.services.devices.add('Phone', deviceToken)
  const registration = {
    runtimeId: 'paired-host',
    platform: 'ios',
    token: 'a'.repeat(64),
    environment: 'production',
    managedToken: 'm'.repeat(43),
  }
  const register = (token: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/notifications/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    })
  expect((await register('unpaired')).status).toBe(401)
  const response = await register(deviceToken)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ configured: true, registered: true })
  expect(JSON.stringify(runtime.services.store.get())).not.toContain(registration.managedToken)
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(
    registration.managedToken,
  )
})
