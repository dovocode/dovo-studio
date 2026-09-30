import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http2'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose'
import { Apns } from './apns'
const target = vi.hoisted(() => ({ url: '' }))
vi.mock('node:http2', async (original) => {
  const native = await original<typeof import('node:http2')>()
  return { ...native, connect: vi.fn<typeof native.connect>(() => native.connect(target.url)) }
})
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
it('uses separate alert and Live Activity topics, shares one signed provider token, and returns APNs failure reasons', async () => {
  const key = await generateKeyPair('ES256', { extractable: true })
  const directory = await mkdtemp(join(tmpdir(), 'dovo-apns-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const keyPath = join(directory, 'key.p8')
  await writeFile(keyPath, await exportPKCS8(key.privateKey), { mode: 0o600 })
  const received: Array<{ topic: string; type: string; authorization: string }> = []
  const server = createServer()
  const sessions = new Set<import('node:http2').ServerHttp2Session>()
  server.on('session', (session) => {
    sessions.add(session)
    session.once('close', () => sessions.delete(session))
  })
  server.on('stream', (stream: import('node:http2').ServerHttp2Stream, headers) => {
    received.push({
      topic: String(headers['apns-topic']),
      type: String(headers['apns-push-type']),
      authorization: String(headers.authorization),
    })
    stream.on('data', () => {})
    stream.on('end', () => {
      stream.respond({ ':status': 400 })
      stream.end(JSON.stringify({ reason: 'BadDeviceToken' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise((resolve, reject) => {
        for (const session of sessions) session.destroy()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No APNs test listener')
  target.url = `http://127.0.0.1:${address.port}`
  const sender = new Apns({
    keyPath,
    keyId: 'test-key',
    teamId: 'test-team',
    bundleId: 'com.dovo.studio',
    production: false,
  })
  const [alert, activity] = await Promise.all([
    sender.sendAlert(
      'a'.repeat(64),
      { aps: { alert: { title: 'Done', body: 'Verified' } } },
      'b'.repeat(64),
    ),
    sender.send('a'.repeat(64), { aps: { event: 'update' } }),
  ])
  expect(alert).toEqual({ status: 400, reason: 'BadDeviceToken' })
  expect(activity).toBe(400)
  expect(received).toContainEqual({
    topic: 'com.dovo.studio',
    type: 'alert',
    authorization: received[0].authorization,
  })
  expect(received).toContainEqual({
    topic: 'com.dovo.studio.push-type.liveactivity',
    type: 'liveactivity',
    authorization: received[0].authorization,
  })
  const verified = await jwtVerify(received[0].authorization.replace('bearer ', ''), key.publicKey)
  expect(verified.payload.iss).toBe('test-team')
})
