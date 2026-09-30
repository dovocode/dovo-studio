import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createRelay } from './server'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const token = 'test-relay-secret-at-least-thirty-two-characters'
  const send = vi
    .fn<NonNullable<Parameters<typeof createRelay>[0]['send']>>()
    .mockResolvedValue({ delivered: true, invalidToken: false })
  const relay = createRelay({ token, platforms: { ios: true, android: true }, send })
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise((resolve, reject) => {
        relay.close((error) => (error ? reject(error) : resolve()))
        relay.closeAllConnections()
      }),
  )
  const address = relay.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  const url = `http://127.0.0.1:${address.port}`
  const value = {
    platform: 'ios',
    token: 'a'.repeat(64),
    environment: 'sandbox',
    id: 'b'.repeat(64),
    title: 'Task needs input',
    body: 'Choose a worktree',
    data: { runtimeId: 'runtime', taskId: 'task', kind: 'input' },
  }
  const post = (body: object, credential = token) =>
    fetch(`${url}/v1/notifications`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { url, value, send, post }
}
it('requires relay authentication and validates payloads before delivery', async () => {
  const f = await setup()
  expect((await f.post(f.value, 'invalid')).status).toBe(401)
  expect((await f.post({ ...f.value, token: 'invalid' })).status).toBe(400)
  expect((await f.post({ ...f.value, body: 'x'.repeat(20_000) })).status).toBe(413)
  expect(f.send).not.toHaveBeenCalled()
  expect((await fetch(`${f.url}/health`)).status).toBe(200)
})
it('delivers iOS and Android notifications and coalesces concurrent retries', async () => {
  const f = await setup()
  const responses = await Promise.all([f.post(f.value), f.post(f.value)])
  expect(responses.every((response) => response.status === 200)).toBe(true)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(await (await f.post(f.value)).json()).toEqual({ delivered: true, invalidToken: false })
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(
    (await f.post({ ...f.value, platform: 'android', token: 'firebase-device-token' })).status,
  ).toBe(200)
  expect(f.send).toHaveBeenCalledTimes(2)
})
it('never caches provider failures or exposes tokens and provider errors in responses', async () => {
  const f = await setup()
  f.send.mockRejectedValueOnce(new Error(`Private token ${f.value.token}`))
  const failed = await f.post(f.value)
  expect(failed.status).toBe(502)
  expect(await failed.text()).not.toContain(f.value.token)
  expect((await f.post(f.value)).status).toBe(200)
  expect(f.send).toHaveBeenCalledTimes(2)
})
