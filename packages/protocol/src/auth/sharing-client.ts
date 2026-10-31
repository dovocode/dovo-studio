import { decode, mutableArray, mutableStruct } from '../shared/schema.js'
import {
  decryptSharing,
  decryptSharedContent,
  encryptSharing,
  encryptSharedContent,
  newSharingKey,
  sharingHash,
  sharingSigningKey,
  sharingReaderKeys,
  shareRecordSchema,
  sharingVaultSchema,
  sharingKeySchema,
  sharingUUID,
  encryptedSuggestionSchema,
  decryptSuggestion,
  shareIndexSchema,
  type ShareRecord,
  type SharingVault,
  type SharedContent,
} from '../conversation/encrypted-sharing.js'
import type { AccountStorage } from './account.js'
import { internetBytes, internetPublicKey, openInternet, sealInternet } from './account-internet.js'
import {
  sharingKeyInboxSchema,
  sharingKeyTransferSchema,
  sharingRecoverySchema,
} from './sharing-key-sync.js'

export type OpenShare = { record: ShareRecord; vault: SharingVault; content: SharedContent }
export type SharingSession = { userId: string; sessionId: string }
export class SharingClient {
  syncError = ''
  recoveryState: 'checking' | 'ready' | 'missing' | 'empty' | 'unavailable' = 'checking'
  private syncUsers = 0
  private syncTimer?: ReturnType<typeof setTimeout>
  private syncSettled = false
  private syncFailures = 0
  private syncGeneration = 0
  private syncActive = () => true
  private exchange?: { sessionId: string; secret: Uint8Array; publicKey: string }
  private syncing?: { sessionId: string; promise: Promise<boolean> }
  private verifiedKey?: { sessionId: string; hash: string; valid: boolean }
  private revision = 0
  private listeners = new Set<() => void>()
  snapshot = () => this.revision
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private changed() {
    this.revision++
    for (const listener of this.listeners) listener()
  }
  constructor(
    private storage: AccountStorage,
    private connectOrigin: string,
    private session: () => SharingSession | null,
    private grant: (origin: string) => Promise<string>,
    private sync?: {
      request: (method: 'POST' | 'PUT', body: unknown) => Promise<unknown>
      origin: () => Promise<string>
      recovery?: (method: 'GET' | 'PUT', body?: unknown) => Promise<unknown>
    },
  ) {}
  /** Shared by every account consumer; sync never generates a replacement sharing key. */
  startSync = (active: () => boolean = () => true) => {
    if (!this.sync || !this.storage.readSharingKey || !this.storage.writeSharingKey) return () => {}
    if (this.syncUsers++ === 0) {
      this.syncActive = active
      this.syncFailures = 0
      this.refreshSync()
    }
    let released = false
    return () => {
      if (released) return
      released = true
      if (--this.syncUsers === 0) {
        this.syncGeneration++
        clearTimeout(this.syncTimer)
        this.syncTimer = undefined
        this.syncActive = () => true
      }
    }
  }
  /** Foreground and explicit refresh bypass the background cadence. */
  refreshSync = () => {
    clearTimeout(this.syncTimer)
    this.syncTimer = undefined
    const generation = ++this.syncGeneration
    if (!this.syncUsers || !this.syncActive()) return
    void this.syncKey()
      .then(
        () => {
          if (generation === this.syncGeneration) this.syncFailures = 0
        },
        () => {
          if (generation === this.syncGeneration)
            this.syncFailures = Math.min(this.syncFailures + 1, 6)
        },
      )
      .finally(() => {
        if (!this.syncUsers || generation !== this.syncGeneration) return
        const delay = this.syncFailures
          ? Math.min(10_000 * 2 ** (this.syncFailures - 1), 300_000)
          : this.syncSettled || this.recoveryState === 'ready' || this.recoveryState === 'empty'
            ? 300_000
            : 10_000
        this.syncTimer = setTimeout(this.refreshSync, delay)
      })
  }
  syncKey = async (): Promise<boolean> => {
    const session = this.session()
    if (!this.sync || !session || !this.storage.readSharingKey || !this.storage.writeSharingKey)
      return false
    if (this.syncing?.sessionId === session.sessionId) return this.syncing.promise
    const pending = { sessionId: session.sessionId, promise: this.exchangeKey(session) }
    this.syncing = pending
    try {
      const restored = await pending.promise
      this.check(session)
      if (this.syncError) {
        this.syncError = ''
        this.changed()
      }
      return restored
    } catch (error) {
      if (this.session()?.sessionId === session.sessionId) {
        const message =
          this.sync.recovery && error instanceof Error
            ? error.message
            : 'Sharing access could not sync. Check your connection; Studio will retry automatically.'
        if (this.sync.recovery) this.recoveryState = 'unavailable'
        if (this.syncError !== message) {
          this.syncError = message
          this.changed()
        }
      }
      throw error
    } finally {
      if (this.syncing === pending) this.syncing = undefined
    }
  }
  private async exchangeKey(session: SharingSession) {
    const sync = this.sync
    if (!sync) return false
    const exchange = this.exchangeFor(session)
    let accountRestored = false
    let key = await this.readRecoveryKey(false)
    this.check(session)
    if (key) {
      const hash = sharingHash(key)
      if (this.verifiedKey?.sessionId !== session.sessionId || this.verifiedKey.hash !== hash) {
        const origin = await sync.origin()
        this.check(session)
        const records = await this.list(origin)
        this.check(session)
        let valid = true
        try {
          for (const record of records)
            decode(sharingVaultSchema, decryptSharing(record.ownerBox, key))
        } catch {
          valid = false
        }
        this.verifiedKey = { sessionId: session.sessionId, hash, valid }
      }
      if (!this.verifiedKey.valid) key = null
    }
    if (sync.recovery) {
      let recovery = decode(sharingRecoverySchema, await sync.recovery('GET'))
      this.check(session)
      if (!recovery.key && key && (!recovery.keyHash || recovery.keyHash === sharingHash(key))) {
        recovery = decode(sharingRecoverySchema, await sync.recovery('PUT', { key }))
        this.check(session)
      }
      if (recovery.key) {
        if (sharingHash(recovery.key) !== recovery.keyHash)
          throw new Error('Account sharing recovery fingerprint changed')
        const restored = key !== recovery.key
        if (restored) await this.restoreKey(recovery.key, await sync.origin())
        this.check(session)
        this.setRecoveryState('ready')
        accountRestored = restored
        key = recovery.key
      } else {
        this.setRecoveryState(
          recovery.keyHash || this.verifiedKey?.valid === false ? 'missing' : 'empty',
        )
      }
    }
    const inbox = decode(
      sharingKeyInboxSchema,
      await sync.request('POST', {
        publicKey: exchange.publicKey,
        hasKey: !!key,
        keyHash: key ? sharingHash(key) : null,
      }),
    )
    this.check(session)
    this.syncSettled = !!key && inbox.keyHash === sharingHash(key)
    if (key && inbox.keyHash === sharingHash(key)) {
      for (const recipient of inbox.requests) {
        this.check(session)
        await sync.request('PUT', {
          sender: exchange.publicKey,
          recipient,
          box: sealInternet(
            {
              origin: this.connectOrigin,
              userId: session.userId,
              recipient,
              key,
            },
            recipient,
            exchange.secret,
            internetBytes(newSharingKey()).slice(0, 24),
          ),
        })
        this.check(session)
      }
      return accountRestored
    }
    if (!inbox.answer) return accountRestored
    try {
      if (inbox.answer.recipient !== exchange.publicKey)
        throw new Error('Sharing recipient changed')
      const transfer = decode(
        sharingKeyTransferSchema,
        openInternet(inbox.answer.box, inbox.answer.sender, exchange.secret),
      )
      if (
        transfer.origin !== this.connectOrigin ||
        transfer.userId !== session.userId ||
        transfer.recipient !== exchange.publicKey
      )
        throw new Error('Sharing transfer belongs to another account or device')
      if (sharingHash(transfer.key) !== inbox.keyHash)
        throw new Error('Sharing key fingerprint changed')
      const origin = await sync.origin()
      this.check(session)
      // Validate every existing owner vault before persisting a transferred key.
      await this.restoreKey(transfer.key, origin)
      this.check(session)
      if (sync.recovery) {
        const recovery = decode(
          sharingRecoverySchema,
          await sync.recovery('PUT', { key: transfer.key }),
        )
        this.check(session)
        if (recovery.key !== transfer.key)
          throw new Error('Account sharing recovery changed. Try again.')
        this.setRecoveryState('ready')
      }
      await sync.request('POST', {
        publicKey: exchange.publicKey,
        hasKey: true,
        keyHash: sharingHash(transfer.key),
      })
      this.check(session)
      return true
    } catch (error) {
      this.check(session)
      // A bad packet must not occupy the mailbox forever. Only the receiver can reject it.
      await sync.request('POST', {
        publicKey: exchange.publicKey,
        hasKey: false,
        keyHash: null,
        rejectAnswer: inbox.answer.box.nonce,
      })
      throw error
    }
  }
  private exchangeFor(session: SharingSession) {
    if (this.exchange?.sessionId !== session.sessionId) {
      const secret = internetBytes(newSharingKey())
      this.exchange = { sessionId: session.sessionId, secret, publicKey: internetPublicKey(secret) }
    }
    return this.exchange
  }
  private setRecoveryState(state: SharingClient['recoveryState']) {
    if (state !== this.recoveryState) {
      this.recoveryState = state
      this.changed()
    }
  }
  private current() {
    const session = this.session()
    if (!session) throw new Error('Sign in to manage sharing')
    return session
  }
  private check(session: SharingSession) {
    const current = this.session()
    if (current?.sessionId !== session.sessionId || current.userId !== session.userId)
      throw new Error('Sharing account changed')
  }
  async request(origin: string, path: string, method = 'GET', body?: unknown) {
    const session = this.current(),
      grant = await this.grant(origin)
    const response = await fetch(origin + path, {
      method,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: 'Bearer ' + grant,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (this.session()?.sessionId !== session.sessionId) throw new Error('Sharing account changed')
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? 'Sharing changed. Refresh and try again.'
          : response.status === 413
            ? 'Hosted storage limit reached.'
            : 'Sharing request failed. Check your connection and try again.',
      )
    return (await response.json()) as unknown
  }
  async key() {
    const session = this.current()
    if (!this.storage.readSharingKey)
      throw new Error('Secure sharing key storage is unavailable on this device')
    const key = await this.storage.readSharingKey(this.connectOrigin, session.userId)
    this.check(session)
    if (!key) throw new Error('Set up or restore your sharing recovery key first')
    return decode(sharingKeySchema, key)
  }
  private creatingKey: { sessionId: string; promise: Promise<string | null> } | null = null
  async recoveryKey(create = false): Promise<string | null> {
    const session = this.current()
    if (this.creatingKey?.sessionId === session.sessionId) return this.creatingKey.promise
    if (!create) return this.readRecoveryKey(false)
    const pending = { sessionId: session.sessionId, promise: this.readRecoveryKey(true) }
    this.creatingKey = pending
    try {
      return await pending.promise
    } finally {
      if (this.creatingKey === pending) this.creatingKey = null
    }
  }
  private async readRecoveryKey(create: boolean) {
    const session = this.current()
    if (!this.storage.readSharingKey || !this.storage.writeSharingKey)
      throw new Error('Secure sharing key storage is unavailable')
    const saved = await this.storage.readSharingKey(this.connectOrigin, session.userId)
    this.check(session)
    if (
      saved &&
      !(
        this.verifiedKey?.sessionId === session.sessionId &&
        this.verifiedKey.hash === sharingHash(saved) &&
        !this.verifiedKey.valid
      )
    )
      return decode(sharingKeySchema, saved)
    if (!create) return null
    const key = newSharingKey()
    if (this.sync) {
      const origin = await this.sync.origin()
      this.check(session)
      if (this.sync.recovery) {
        let recovery = decode(sharingRecoverySchema, await this.sync.recovery('GET'))
        this.check(session)
        if (!recovery.key) {
          if ((await this.list(origin)).length || recovery.keyHash)
            throw new Error(
              'This sharing key predates account recovery. Restore it from another device or reset legacy sharing.',
            )
          this.check(session)
          recovery = decode(sharingRecoverySchema, await this.sync.recovery('PUT', { key }))
          this.check(session)
        }
        if (!recovery.key || sharingHash(recovery.key) !== recovery.keyHash)
          throw new Error('Account sharing recovery is invalid')
        await this.restoreKey(recovery.key, origin)
        this.check(session)
        this.setRecoveryState('ready')
        return recovery.key
      }
      if ((await this.list(origin)).length)
        throw new Error('Sharing access is syncing from your other devices')
      this.check(session)
      const exchange = this.exchangeFor(session)
      const inbox = decode(
        sharingKeyInboxSchema,
        await this.sync.request('POST', {
          publicKey: exchange.publicKey,
          hasKey: true,
          keyHash: sharingHash(key),
        }),
      )
      this.check(session)
      if (inbox.keyHash !== sharingHash(key))
        throw new Error(
          'Sharing access is syncing. Keep another signed-in device online and try again shortly.',
        )
    }
    await this.storage.writeSharingKey(key, this.connectOrigin, session.userId)
    this.check(session)
    return key
  }
  async restoreKey(key: string, origin: string) {
    const checked = decode(sharingKeySchema, key.trim()),
      session = this.current()
    const shares = await this.list(origin)
    // A wrong recovery key must never overwrite a working one.
    for (const record of shares)
      decode(sharingVaultSchema, decryptSharing(record.ownerBox, checked))
    this.check(session)
    if (this.sync?.recovery) {
      const recovery = decode(sharingRecoverySchema, await this.sync.recovery('GET'))
      this.check(session)
      if (recovery.keyHash && recovery.keyHash !== sharingHash(checked))
        throw new Error(
          'This backup belongs to a different sharing key. Use account recovery instead.',
        )
    }
    if (!this.storage.writeSharingKey) throw new Error('Secure sharing key storage is unavailable')
    await this.storage.writeSharingKey(checked, this.connectOrigin, session.userId)
    this.check(session)
    this.verifiedKey = undefined
    this.changed()
  }
  /** Explicitly confirmed by the UI; never runs during background recovery. */
  async resetLegacySharing(origin: string) {
    const session = this.current(),
      recoveryRequest = this.sync?.recovery
    if (!recoveryRequest)
      throw new Error('Update Connect to enable account-managed sharing recovery.')
    // Wait for a running recovery before deciding a reset is necessary.
    await this.syncKey()
    this.check(session)
    const previous = decode(sharingRecoverySchema, await recoveryRequest('GET'))
    this.check(session)
    if (previous.key)
      throw new Error('Sharing access is recoverable. Refresh instead of resetting.')
    const records = await this.list(origin)
    this.check(session)
    for (const record of records) {
      await this.remove(origin, record.id)
      this.check(session)
    }
    const recovery = decode(
      sharingRecoverySchema,
      await recoveryRequest('PUT', {
        key: newSharingKey(),
        reset: { keyHash: previous.keyHash },
      }),
    )
    this.check(session)
    if (!recovery.key || sharingHash(recovery.key) !== recovery.keyHash)
      throw new Error('Account sharing recovery is invalid')
    await this.restoreKey(recovery.key, origin)
    this.check(session)
    this.setRecoveryState('ready')
  }
  async list(origin: string) {
    return decode(
      mutableStruct({ shares: mutableArray(shareIndexSchema) }),
      await this.request(origin, '/v2/shares'),
    ).shares
  }
  source(kind: 'artifact' | 'thread', id: string, key: string) {
    // Opaque source IDs keep local task and artifact IDs off the public service.
    return sharingHash(JSON.stringify(['dovo-share-source-v1', key, kind, id]))
  }
  async open(record: ShareRecord): Promise<OpenShare> {
    const vault = decode(sharingVaultSchema, decryptSharing(record.ownerBox, await this.key()))
    return {
      record,
      vault,
      content: decryptSharedContent(record.id, record.packet, sharingReaderKeys(vault)),
    }
  }
  async refresh(origin: string, id: string) {
    return this.open(decode(shareRecordSchema, await this.request(origin, '/v2/shares/' + id)))
  }
  async publish(origin: string, sourceId: string, content: SharedContent): Promise<OpenShare> {
    if (this.sync?.recovery && this.recoveryState !== 'ready') await this.syncKey()
    if (this.sync?.recovery && this.recoveryState !== 'ready')
      throw new Error('Save or recover your sharing key with your account before publishing.')
    const key = await this.key(),
      source = this.source(content.kind, sourceId, key)
    const existing = (await this.list(origin)).find((record) => record.source === source)
    if (existing) return this.refresh(origin, existing.id)
    const vault: SharingVault = {
      contentKey: newSharingKey(),
      signingSeed: newSharingKey(),
      suggestionSecret: newSharingKey(),
      grants: [],
    }
    const id = sharingUUID()
    const record: ShareRecord = {
      id,
      source,
      kind: content.kind,
      version: 1,
      updatedAt: Date.now(),
      signingKey: sharingSigningKey(vault.signingSeed),
      packet: encryptSharedContent(id, sharingUUID(), content, vault),
      ownerBox: encryptSharing(vault, key),
      grants: [],
      paused: true,
    }
    const saved = decode(
      shareRecordSchema,
      await this.request(origin, '/v2/shares/' + id, 'PUT', { expectedVersion: 0, record }),
    )
    this.changed()
    return { record: saved, vault, content }
  }
  async save(origin: string, share: OpenShare) {
    const record = { ...share.record, ownerBox: encryptSharing(share.vault, await this.key()) }
    const saved = decode(
      shareRecordSchema,
      await this.request(origin, '/v2/shares/' + record.id, 'PUT', {
        expectedVersion: record.version,
        record,
      }),
    )
    this.changed()
    return { ...share, record: saved }
  }
  async invite(
    origin: string,
    share: OpenShare,
    userId?: string,
    seconds = 604800,
    organizationId?: string,
  ) {
    const next = await this.refresh(origin, share.record.id),
      id = sharingUUID(),
      key = newSharingKey(),
      token = userId || organizationId ? undefined : newSharingKey()
    if (userId && next.record.grants.some((grant) => grant.userId === userId.trim()))
      throw new Error('This account is already invited')
    if (
      organizationId &&
      next.record.grants.some((grant) => grant.organizationId === organizationId)
    )
      throw new Error('This organisation already has access')
    next.vault.grants.push({ id, key, token })
    next.record.grants.push({
      id,
      userId: userId?.trim(),
      organizationId,
      tokenHash: token ? sharingHash(token) : undefined,
      expiresAt: token ? Date.now() + seconds * 1000 : undefined,
      box: encryptSharing(sharingReaderKeys(next.vault), key),
    })
    return this.save(origin, next)
  }
  link(origin: string, share: OpenShare, access: string) {
    const secret = share.vault.grants.find((grant) => grant.id === access)
    if (!secret) throw new Error('Sharing link key is missing')
    const params = new URLSearchParams({ access, key: secret.key })
    if (secret.token) params.set('share', secret.token)
    return origin + '/e/' + share.record.id + '#' + params.toString()
  }
  async revoke(origin: string, share: OpenShare, access: string) {
    const next = await this.refresh(origin, share.record.id)
    next.vault.contentKey = newSharingKey()
    next.vault.grants = next.vault.grants.filter((grant) => grant.id !== access)
    next.record.grants = next.record.grants
      .filter((grant) => grant.id !== access)
      .map((grant) => {
        const secret = next.vault.grants.find((secret) => secret.id === grant.id)
        if (!secret) throw new Error('Sharing key is missing')
        return { ...grant, box: encryptSharing(sharingReaderKeys(next.vault), secret.key) }
      })
    next.record.packet = encryptSharedContent(
      next.record.id,
      sharingUUID(),
      next.content,
      next.vault,
    )
    // An old writer cannot publish with the revoked content key. Resume explicitly after rotation.
    next.record.paused = true
    next.record.writerHash = undefined
    return this.save(origin, next)
  }
  async setPaused(origin: string, share: OpenShare, paused: boolean) {
    const next = await this.refresh(origin, share.record.id)
    const writer = paused ? undefined : newSharingKey()
    next.record.paused = paused
    next.record.writerHash = writer ? sharingHash(writer) : undefined
    return { share: await this.save(origin, next), writer }
  }
  async suggestionInbox(origin: string, sourceId: string) {
    const key = await this.recoveryKey()
    if (!key) return null
    const source = this.source('thread', sourceId, key)
    const record = (await this.list(origin)).find((record) => record.source === source)
    if (!record) return null
    const vault = decode(sharingVaultSchema, decryptSharing(record.ownerBox, key))
    return { id: record.id, suggestions: await this.suggestions(origin, { record, vault }) }
  }
  async suggestions(
    origin: string,
    share: { record: Pick<ShareRecord, 'id'>; vault: Pick<SharingVault, 'suggestionSecret'> },
  ) {
    const result = decode(
      mutableStruct({ suggestions: mutableArray(encryptedSuggestionSchema) }),
      await this.request(origin, '/v2/shares/' + share.record.id + '/suggestions'),
    )
    return result.suggestions.map((suggestion) => {
      try {
        return {
          id: suggestion.id,
          value: decryptSuggestion(share.record.id, suggestion, share.vault.suggestionSecret),
          error: '',
        }
      } catch {
        return {
          id: suggestion.id,
          value: null,
          error: 'This suggestion could not be authenticated or decrypted.',
        }
      }
    })
  }
  async dismiss(origin: string, id: string, suggestion: string) {
    await this.request(origin, '/v2/shares/' + id + '/suggestions/' + suggestion, 'DELETE')
    this.changed()
  }
  async remove(origin: string, id: string) {
    await this.request(origin, '/v2/shares/' + id, 'DELETE')
    this.changed()
  }
}
