import { expect, it } from 'vite-plus/test'
import { SharingClient } from './sharing-client.js'
import type { AccountStorage } from './account.js'

it('creates one recovery key when sharing panels initialize concurrently', async () => {
  let saved: string | null = null
  const writes: string[] = []
  const storage: AccountStorage = {
    read: async () => null,
    write: async () => {},
    readSharingKey: async () => saved,
    writeSharingKey: async (key) => {
      writes.push(key)
      saved = key
    },
  }
  const client = new SharingClient(
    storage,
    'https://connect.example',
    () => ({ userId: 'owner', sessionId: 'session' }),
    async () => '',
  )
  const [first, second, read] = await Promise.all([
    client.recoveryKey(true),
    client.recoveryKey(true),
    client.recoveryKey(),
  ])
  expect(first).toMatch(/^[a-f0-9]{64}$/)
  expect(second).toBe(first)
  expect(read).toBe(first)
  expect(writes).toEqual([first])
  expect(await client.key()).toBe(first)
})
