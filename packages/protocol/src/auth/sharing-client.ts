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

export type OpenShare = { record: ShareRecord; vault: SharingVault; content: SharedContent }
export type SharingSession = { userId: string; sessionId: string }
export class SharingClient {
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
  ) {}
  private current() {
    const session = this.session()
    if (!session) throw new Error('Sign in to manage sharing')
    return session
  }
  private check(session: SharingSession) {
    if (this.session()?.sessionId !== session.sessionId) throw new Error('Sharing account changed')
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
    if (saved) return decode(sharingKeySchema, saved)
    if (!create) return null
    const key = newSharingKey()
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
    if (!this.storage.writeSharingKey) throw new Error('Secure sharing key storage is unavailable')
    await this.storage.writeSharingKey(checked, this.connectOrigin, session.userId)
    this.check(session)
    this.changed()
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
