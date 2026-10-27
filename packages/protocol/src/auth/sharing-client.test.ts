import { afterEach, expect, it, vi } from 'vite-plus/test'
import { SharingClient, type SharingSession } from './sharing-client.js'
import { decode } from '../shared/schema.js'
import {
  newSharingKey,
  sharingHash,
  encryptSharing,
  sharingUUID,
} from '../conversation/encrypted-sharing.js'
import { internetBytes, internetPublicKey, sealInternet } from './account-internet.js'
import { sharingKeyPresenceSchema, sharingKeyAnswerSchema } from './sharing-key-sync.js'
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

function device(saved: string | null = null) {
  const state = {
    saved,
    session: { userId: 'owner', sessionId: 'session' } as SharingSession | null,
  }
  const write = vi.fn<(key: string) => Promise<void>>(async (key) => {
    state.saved = key
  })
  const storage: AccountStorage = {
    read: async () => null,
    write: async () => {},
    readSharingKey: async () => state.saved,
    writeSharingKey: write,
  }
  return { state, storage, write }
}
const connectOrigin = 'https://connect.example'
const sharingOrigin = 'https://share.example'
function mailbox() {
  let keyHash: string | null = null
  const devices = new Map<
    string,
    { hasKey: boolean; answer: typeof sharingKeyAnswerSchema.Type | null }
  >()
  return async (method: 'POST' | 'PUT', body: unknown) => {
    if (method === 'PUT') {
      const answer = decode(sharingKeyAnswerSchema, body)
      const recipient = devices.get(answer.recipient)
      if (recipient && !recipient.answer) recipient.answer = answer
      return { ok: true }
    }
    const input = decode(sharingKeyPresenceSchema, body)
    keyHash ??= input.keyHash
    const hasKey = input.hasKey && input.keyHash === keyHash
    const previous = devices.get(input.publicKey)
    devices.set(input.publicKey, {
      hasKey,
      answer:
        hasKey || previous?.answer?.box.nonce === input.rejectAnswer
          ? null
          : (previous?.answer ?? null),
    })
    return {
      keyHash,
      requests: hasKey
        ? [...devices]
            .filter(([id, value]) => id !== input.publicKey && !value.hasKey && !value.answer)
            .map(([id]) => id)
        : [],
      answer: devices.get(input.publicKey)!.answer,
    }
  }
}
type SyncRequest = (method: 'POST' | 'PUT', body: unknown) => Promise<unknown>
function clientFor(
  target: ReturnType<typeof device>,
  request: (method: 'POST' | 'PUT', body: unknown) => Promise<unknown>,
) {
  const client = new SharingClient(
    target.storage,
    connectOrigin,
    () => target.state.session,
    async () => '',
    { request, origin: async () => sharingOrigin },
  )
  vi.spyOn(client, 'list').mockResolvedValue([])
  return client
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('converges simultaneous first shares on one key and transfers it without exposing it to the mailbox', async () => {
  const request = vi.fn<SyncRequest>(mailbox()),
    first = device(),
    second = device()
  const source = clientFor(first, request),
    receiver = clientFor(second, request)
  const results = await Promise.allSettled([source.recoveryKey(true), receiver.recoveryKey(true)])
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(first.write).toHaveBeenCalledTimes(1)
  expect(second.write).not.toHaveBeenCalled()
  await receiver.syncKey()
  await source.syncKey()
  expect(await receiver.syncKey()).toBe(true)
  expect(second.state.saved).toBe(first.state.saved)
  expect(JSON.stringify(request.mock.calls)).not.toContain(first.state.saved)
})

it('waits without generating a replacement key when existing publications need recovery', async () => {
  const empty = device(),
    client = clientFor(empty, vi.fn<SyncRequest>(mailbox()))
  const key = newSharingKey()
  vi.spyOn(client, 'list').mockResolvedValue([
    {
      id: sharingUUID(),
      source: 'opaque',
      kind: 'thread',
      version: 1,
      updatedAt: 1,
      ownerBox: encryptSharing(
        {
          contentKey: newSharingKey(),
          signingSeed: newSharingKey(),
          suggestionSecret: newSharingKey(),
          grants: [],
        },
        key,
      ),
    },
  ])
  expect(await client.syncKey()).toBe(false)
  await expect(client.recoveryKey(true)).rejects.toThrow('syncing')
  expect(empty.write).not.toHaveBeenCalled()
})

it.each(['origin', 'account', 'recipient', 'fingerprint', 'ciphertext', 'vault'] as const)(
  'rejects an invalid %s transfer without overwriting secure storage and clears only its failed answer',
  async (failure) => {
    const oldKey = newSharingKey(),
      key = newSharingKey(),
      target = device(oldKey)
    const secret = internetBytes(newSharingKey())
    const request = vi.fn<SyncRequest>(async (method, body) => {
      expect(method).toBe('POST')
      const input = decode(sharingKeyPresenceSchema, body)
      if (input.rejectAnswer) return { keyHash: sharingHash(key), requests: [], answer: null }
      const transfer = {
        origin: connectOrigin,
        userId: 'owner',
        recipient: input.publicKey,
        key,
        ...(failure === 'origin' ? { origin: 'https://other.example' } : {}),
        ...(failure === 'account' ? { userId: 'other' } : {}),
        ...(failure === 'recipient' ? { recipient: '0'.repeat(64) } : {}),
      }
      const box = sealInternet(
        transfer,
        input.publicKey,
        secret,
        internetBytes(newSharingKey()).slice(0, 24),
      )
      if (failure === 'ciphertext') box.ciphertext = '0'.repeat(box.ciphertext.length)
      return {
        keyHash: failure === 'fingerprint' ? sharingHash(newSharingKey()) : sharingHash(key),
        requests: [],
        answer: { sender: internetPublicKey(secret), recipient: input.publicKey, box },
      }
    })
    const client = clientFor(target, request)
    if (failure === 'vault')
      vi.spyOn(client, 'list').mockResolvedValue([
        {
          id: sharingUUID(),
          source: 'opaque',
          kind: 'thread',
          version: 1,
          updatedAt: 1,
          ownerBox: encryptSharing(
            {
              contentKey: newSharingKey(),
              signingSeed: newSharingKey(),
              suggestionSecret: newSharingKey(),
              grants: [],
            },
            oldKey,
          ),
        },
      ])
    await expect(client.syncKey()).rejects.toThrow(/Sharing|sharing|decrypt|Encrypted/)
    expect(target.state.saved).toBe(oldKey)
    expect(target.write).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith(
      'POST',
      expect.objectContaining({ hasKey: false, keyHash: null, rejectAnswer: expect.any(String) }),
    )
  },
)

it('rejects a transfer if the account changes while its response is in flight', async () => {
  const target = device()
  let respond: (value: unknown) => void = () => {}
  const request = vi.fn<SyncRequest>(
    () =>
      new Promise<unknown>((resolve) => {
        respond = resolve
      }),
  )
  const client = clientFor(target, request)
  const pending = client.syncKey()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  target.state.session = { userId: 'other', sessionId: 'other-session' }
  respond({ keyHash: null, requests: [], answer: null })
  await expect(pending).rejects.toThrow('account changed')
  expect(target.write).not.toHaveBeenCalled()
})

it('shares one background timer across account consumers and stops after the last unmount', async () => {
  vi.useFakeTimers()
  const target = device(),
    request = vi.fn<SyncRequest>(mailbox()),
    client = clientFor(target, request)
  const first = client.startSync(),
    second = client.startSync()
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledTimes(1)
  first()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(request).toHaveBeenCalledTimes(2)
  second()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(request).toHaveBeenCalledTimes(2)
})
