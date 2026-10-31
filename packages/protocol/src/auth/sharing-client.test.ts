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
import {
  sharingKeyPresenceSchema,
  sharingKeyAnswerSchema,
  sharingRecoverySaveSchema,
} from './sharing-key-sync.js'
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

function recoveryBroker(
  key: string | null = null,
  keyHash: string | null = key ? sharingHash(key) : null,
) {
  const state = { key, keyHash }
  const recovery = vi.fn<(method: 'GET' | 'PUT', body?: unknown) => Promise<unknown>>(
    async (method, body) => {
      if (method === 'PUT') {
        const input = decode(sharingRecoverySaveSchema, body)
        if (input.reset) {
          if (state.key || input.reset.keyHash !== state.keyHash)
            throw new Error('Sharing recovery changed')
        } else if (!state.key && state.keyHash && state.keyHash !== sharingHash(input.key)) {
          throw new Error('Restore the original sharing key')
        }
        state.key ??= input.key
        state.keyHash = sharingHash(state.key)
      }
      return { ...state }
    },
  )
  const request = vi.fn<SyncRequest>(async (_method, body) => {
    const presence = decode(sharingKeyPresenceSchema, body)
    return { keyHash: state.keyHash ?? presence.keyHash, requests: [], answer: null }
  })
  return { state, recovery, request }
}
function managedClient(
  target: ReturnType<typeof device>,
  broker: ReturnType<typeof recoveryBroker>,
) {
  const client = new SharingClient(
    target.storage,
    connectOrigin,
    () => target.state.session,
    async () => '',
    {
      request: broker.request,
      recovery: broker.recovery,
      origin: async () => sharingOrigin,
    },
  )
  vi.spyOn(client, 'list').mockResolvedValue([])
  return client
}
function existingShare(key: string) {
  return {
    id: sharingUUID(),
    source: 'opaque',
    kind: 'thread' as const,
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
  }
}

it('migrates an existing valid key and restores it without the original device or a backup', async () => {
  const key = newSharingKey(),
    broker = recoveryBroker(null, sharingHash(key))
  const source = managedClient(device(key), broker)
  vi.spyOn(source, 'list').mockResolvedValue([existingShare(key)])
  await source.syncKey()
  expect(broker.state.key).toBe(key)
  expect(source.recoveryState).toBe('ready')
  const target = device(),
    receiver = managedClient(target, broker)
  vi.spyOn(receiver, 'list').mockResolvedValue([existingShare(key)])
  expect(await receiver.syncKey()).toBe(true)
  expect(target.state.saved).toBe(key)
  expect(receiver.recoveryState).toBe('ready')
  expect(await receiver.syncKey()).toBe(false)
  expect(target.write).toHaveBeenCalledTimes(1)
})

it('converges first account-managed shares without publishing a key that cannot be recovered', async () => {
  const broker = recoveryBroker(),
    first = device(),
    second = device()
  const source = managedClient(first, broker),
    receiver = managedClient(second, broker)
  const results = await Promise.all([source.recoveryKey(true), receiver.recoveryKey(true)])
  expect(results).toEqual([broker.state.key, broker.state.key])
  expect(first.state.saved).toBe(second.state.saved)
  expect(broker.state.key).not.toBeNull()
})

it.each(['fingerprint', 'vault'] as const)(
  'rejects invalid managed recovery %s without overwriting a device key',
  async (failure) => {
    const old = newSharingKey(),
      key = newSharingKey(),
      broker = recoveryBroker(key)
    if (failure === 'fingerprint') broker.state.keyHash = sharingHash(newSharingKey())
    const target = device(old),
      client = managedClient(target, broker)
    vi.spyOn(client, 'list').mockResolvedValue([existingShare(old)])
    await expect(client.syncKey()).rejects.toThrow(/fingerprint|decrypt|Encrypted/)
    expect(target.state.saved).toBe(old)
    expect(target.write).not.toHaveBeenCalled()
  },
)

it('requires an explicit legacy reset, removes old hosted copies first and saves the new key with the account', async () => {
  const broker = recoveryBroker(null, sharingHash(newSharingKey())),
    target = device()
  const client = managedClient(target, broker),
    record = existingShare(newSharingKey())
  vi.spyOn(client, 'list').mockResolvedValue([record])
  const remove = vi.spyOn(client, 'remove').mockImplementation(async () => {
    vi.spyOn(client, 'list').mockResolvedValue([])
  })
  await client.syncKey()
  expect(client.recoveryState).toBe('missing')
  expect(remove).not.toHaveBeenCalled()
  await expect(client.recoveryKey(true)).rejects.toThrow('predates account recovery')
  await client.resetLegacySharing(sharingOrigin)
  expect(remove).toHaveBeenCalledExactlyOnceWith(sharingOrigin, record.id)
  expect(target.state.saved).toBe(broker.state.key)
  expect(client.recoveryState).toBe('ready')
  expect(broker.recovery).toHaveBeenCalledWith(
    'PUT',
    expect.objectContaining({ reset: expect.any(Object) }),
  )
})

it('does not rotate a legacy key when deleting hosted copies fails', async () => {
  const broker = recoveryBroker(null, sharingHash(newSharingKey())),
    target = device(),
    client = managedClient(target, broker)
  vi.spyOn(client, 'list').mockResolvedValue([existingShare(newSharingKey())])
  vi.spyOn(client, 'remove').mockRejectedValue(new Error('Offline'))
  await expect(client.resetLegacySharing(sharingOrigin)).rejects.toThrow('Offline')
  expect(broker.state.key).toBeNull()
  expect(target.write).not.toHaveBeenCalled()
})

it('refuses resetting recoverable sharing and exposes unavailable recovery instead of creating an unbacked key', async () => {
  const broker = recoveryBroker(newSharingKey()),
    target = device(),
    client = managedClient(target, broker)
  const remove = vi.spyOn(client, 'remove')
  await expect(client.resetLegacySharing(sharingOrigin)).rejects.toThrow('recoverable')
  expect(remove).not.toHaveBeenCalled()
  const unavailable = recoveryBroker(),
    empty = device(),
    offline = managedClient(empty, unavailable)
  unavailable.recovery.mockRejectedValue(
    new Error('Update Connect to enable account-managed sharing recovery.'),
  )
  await expect(offline.syncKey()).rejects.toThrow('Update Connect')
  expect(offline.syncError).toContain('Update Connect')
  expect(offline.recoveryState).toBe('unavailable')
  await expect(offline.recoveryKey(true)).rejects.toThrow('Update Connect')
  expect(empty.write).not.toHaveBeenCalled()
})

it('rejects managed recovery responses after a session change', async () => {
  const broker = recoveryBroker(newSharingKey()),
    target = device(),
    client = managedClient(target, broker)
  broker.recovery.mockImplementation(async () => {
    target.state.session = { userId: 'other', sessionId: 'other' }
    return { ...broker.state }
  })
  await expect(client.syncKey()).rejects.toThrow('account changed')
  expect(target.write).not.toHaveBeenCalled()
})

it('does not publish new content when a device key cannot be saved with the account', async () => {
  const broker = recoveryBroker(),
    target = device(newSharingKey()),
    client = managedClient(target, broker)
  broker.recovery.mockRejectedValue(new Error('Connect unavailable'))
  const request = vi.spyOn(client, 'request')
  await expect(
    client.publish(sharingOrigin, 'source', { kind: 'thread', title: 'Private', messages: [] }),
  ).rejects.toThrow('Connect unavailable')
  expect(request).not.toHaveBeenCalled()
})

it('rejects a backup with a different account fingerprint even before any publication exists', async () => {
  const key = newSharingKey(),
    broker = recoveryBroker(key),
    target = device(key),
    client = managedClient(target, broker)
  await expect(client.restoreKey(newSharingKey(), sharingOrigin)).rejects.toThrow(
    'different sharing key',
  )
  expect(target.state.saved).toBe(key)
  expect(target.write).not.toHaveBeenCalled()
})

it('uses a five minute settled cadence while foreground refresh bypasses it', async () => {
  vi.useFakeTimers()
  const broker = recoveryBroker(newSharingKey())
  const client = managedClient(device(), broker)
  const recovery = vi.spyOn(client, 'syncKey')
  let active = true
  const stop = client.startSync(() => active)
  await vi.advanceTimersByTimeAsync(0)
  expect(client.recoveryState).toBe('ready')
  expect(recovery).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(299_999)
  expect(recovery).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(recovery).toHaveBeenCalledTimes(2)
  active = false
  client.refreshSync()
  await vi.advanceTimersByTimeAsync(900_000)
  expect(recovery).toHaveBeenCalledTimes(2)
  active = true
  client.refreshSync()
  await vi.advanceTimersByTimeAsync(0)
  expect(recovery).toHaveBeenCalledTimes(3)
  stop()
  stop()
  await vi.advanceTimersByTimeAsync(900_000)
  expect(recovery).toHaveBeenCalledTimes(3)
})

it('backs off failures to five minutes and permits immediate explicit retries', async () => {
  vi.useFakeTimers()
  const request = vi.fn<SyncRequest>().mockRejectedValue(new Error('offline'))
  const client = clientFor(device(), request)
  const stop = client.startSync()
  await vi.advanceTimersByTimeAsync(0)
  for (const delay of [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
    const calls = request.mock.calls.length
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(request).toHaveBeenCalledTimes(calls)
    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledTimes(calls + 1)
  }
  const calls = request.mock.calls.length
  await expect(client.syncKey()).rejects.toThrow('offline')
  expect(request).toHaveBeenCalledTimes(calls + 1)
  stop()
})

it('does not rearm an in-flight background sync after its last owner releases', async () => {
  vi.useFakeTimers()
  let complete!: (value: unknown) => void
  const request = vi.fn<SyncRequest>(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const client = clientFor(device(), request)
  const stop = client.startSync()
  await vi.advanceTimersByTimeAsync(0)
  stop()
  stop()
  complete({ keyHash: null, requests: [], answer: null })
  await vi.advanceTimersByTimeAsync(900_000)
  expect(request).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
