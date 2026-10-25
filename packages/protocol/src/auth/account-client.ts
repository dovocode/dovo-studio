import { type ManagedLiveActivity } from '../runtime/previews/live-activities.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  internetPublicKey,
  internetBoxSchema,
  openInternet,
  type internetSetupSchema,
} from './account-internet.js'
import { connectionSchema, type RuntimeConnection } from '../runtime/connection/runtime.js'
import { peerAddress } from '../runtime/connection/peer.js'
import { Schema } from 'effect'
import { SharingClient } from './sharing-client.js'
import { Base64Url } from 'effect/encoding'
import {
  managedPushGrantSchema,
  type ManagedPushSubscription,
} from '../runtime/push-notifications.js'
import { decode, mutableStruct, uuidSchema } from '../shared/schema.js'
import {
  artifactServiceSchema,
  artifactServiceOrigin,
  artifactGrantSchema,
  artifactPublicationInput,
  artifactPublicationResponseSchema,
  HOSTED_ARTIFACT_MAX_BYTES,
  artifactSourcePublicationsSchema,
  type ArtifactSourcePublication,
} from '../conversation/artifact-sharing.js'
import type { Artifact } from '../conversation/artifacts.js'
import {
  artifactFeedCredentialSchema,
  artifactFeedGrantSchema,
  ARTIFACT_FEED_MAX_BYTES,
  type ArtifactFeedCredential,
} from '../conversation/artifact-feeds.js'
import {
  ACCOUNT_DIRECTORY_URL,
  connectServiceOrigin,
  accountDirectorySchema,
  accountLoginSchema,
  type AccountDirectory,
  type AccountLogin,
  type AccountServer,
  type AccountStorage,
} from './account.js'
export type AccountState = {
  directory: AccountDirectory | null
  login: AccountLogin | null
  busy: boolean
  error: string
  deletionPending: boolean
  loaded: boolean
  publications: ArtifactSourcePublication[] | null
  publicationError: string
  publicationOrigin: string
}
export type PublishedArtifact = { publicationId: string; url: string; manageUrl: string }
class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
export class AccountClient {
  readonly sharing: SharingClient
  private token: string | null = null
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  private state: AccountState = {
    directory: null,
    login: null,
    busy: false,
    error: '',
    deletionPending: false,
    loaded: false,
    publications: null,
    publicationError: '',
    publicationOrigin: '',
  }
  readonly origin: string
  private publicationsRequest?: Promise<void>
  private publicationsRevision = 0
  constructor(
    private readonly storage: AccountStorage,
    private readonly open: (url: string) => Promise<unknown>,
    origin = ACCOUNT_DIRECTORY_URL,
    private readonly artifactsOrigin = '',
  ) {
    this.origin = connectServiceOrigin(origin)
    this.sharing = new SharingClient(
      storage,
      this.origin,
      () => {
        const sessionId = this.sessionId(),
          user = this.state.directory?.user
        return sessionId && user && !this.state.deletionPending
          ? { sessionId, userId: user.id }
          : null
      },
      this.sharingGrant,
    )
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private set(value: Partial<AccountState>) {
    this.state = { ...this.state, ...value }
    for (const listener of this.listeners) listener()
  }
  sessionId = () =>
    this.token
      ? bytesToHex(
          sha256(
            utf8ToBytes(
              this.origin === ACCOUNT_DIRECTORY_URL
                ? this.token
                : JSON.stringify([this.origin, this.token]),
            ),
          ),
        )
      : null
  artifactService = async () => {
    const service = decode(artifactServiceSchema, await this.request('/v1/artifacts/service'))
    const origin = artifactServiceOrigin(service.origin)
    if (this.artifactsOrigin && artifactServiceOrigin(this.artifactsOrigin) !== origin)
      throw new Error(
        'The artifact URL does not match Connect. Configure the same artifact origin on your Connect broker and artifact server, or clear the override in Settings.',
      )
    return origin
  }
  sharingService = async () => {
    const service = decode(artifactServiceSchema, await this.request('/v1/sharing/service'))
    return artifactServiceOrigin(service.origin)
  }
  private sharingGrant = async (expectedOrigin: string) => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in to manage sharing')
    const grant = decode(
      artifactGrantSchema,
      await this.request('/v1/sharing/session', 'POST', undefined, undefined, token),
    )
    if (
      this.token !== token ||
      artifactServiceOrigin(grant.origin) !== expectedOrigin ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant.token) ||
      grant.expiresAt <= Date.now()
    )
      throw new Error('Sharing account or destination changed. Refresh and try again')
    return grant.token
  }
  refreshPublications = (): Promise<void> => {
    if (this.publicationsRequest) return this.publicationsRequest
    const token = this.token
    if (!token || !this.state.directory) return Promise.resolve()
    const revision = this.publicationsRevision
    const run = async () => {
      try {
        const origin = await this.artifactService()
        const grant = await this.artifactGrant(origin)
        if (this.token !== token) return
        const response = await fetch(origin + '/v1/publications/sources', {
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: 'Bearer ' + grant },
        })
        if (!response.ok)
          throw new Error('Could not check hosted sharing status. Refresh to try again.')
        const { publications } = decode(artifactSourcePublicationsSchema, await response.json())
        if (this.token === token && revision === this.publicationsRevision)
          this.set({ publications, publicationError: '', publicationOrigin: origin })
      } catch (cause) {
        if (this.token === token && revision === this.publicationsRevision)
          this.set({
            publications: null,
            publicationError:
              cause instanceof Error ? cause.message : 'Could not check hosted sharing status',
          })
      }
    }
    const request = run().finally(() => {
      if (this.publicationsRequest === request) this.publicationsRequest = undefined
    })
    this.publicationsRequest = request
    return request
  }
  artifactManagementUrl = async (publicationId: string, expectedOrigin: string) => {
    const grant = await this.artifactGrant(expectedOrigin)
    return expectedOrigin + '/manage/' + publicationId + '#session=' + grant
  }
  artifactAccessRequest = async (origin: string, path: string, method = 'GET', data?: unknown) => {
    if (
      !/^\/v1\/publications\/[a-f0-9-]{36}(?:\/(?:access|invites|links)(?:\/[a-f0-9-]{36})?)?$/.test(
        path,
      )
    )
      throw new Error('Invalid artifact management action')
    const token = this.token,
      grant = await this.artifactGrant(origin)
    const response = await fetch(origin + path, {
      method,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + grant,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    if (token !== this.token) throw new Error('Sharing account changed')
    if (!response.ok)
      throw new Error('Could not manage the existing hosted artifact. Refresh and try again.')
    return (await response.json()) as unknown
  }
  private artifactGrant = async (expectedOrigin: string) => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in to manage hosted artifacts')
    const grant = decode(
      artifactGrantSchema,
      await this.request('/v1/artifacts/session', 'POST', undefined, undefined, token),
    )
    if (
      this.token !== token ||
      artifactServiceOrigin(grant.origin) !== expectedOrigin ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant.token) ||
      grant.expiresAt <= Date.now()
    )
      throw new Error('Account or artifact destination changed. Refresh and try again')
    if (this.artifactsOrigin && artifactServiceOrigin(this.artifactsOrigin) !== expectedOrigin)
      throw new Error('Artifact destination does not match Settings')
    return grant.token
  }
  /** Only a short-lived artifact grant crosses to the separately configured storage service. */
  publishArtifact = async (
    artifact: Artifact,
    expectedOrigin: string,
  ): Promise<PublishedArtifact> => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in to publish an artifact')
    const body = JSON.stringify(artifactPublicationInput(artifact))
    if (new TextEncoder().encode(body).length > HOSTED_ARTIFACT_MAX_BYTES)
      throw new Error('Hosted artifacts are limited to 20 MB, including source files')
    const grant = decode(
      artifactGrantSchema,
      await this.request('/v1/artifacts/session', 'POST', undefined, undefined, token),
    )
    const origin = artifactServiceOrigin(grant.origin)
    if (this.artifactsOrigin && artifactServiceOrigin(this.artifactsOrigin) !== origin)
      throw new Error('Artifact destination does not match Settings')
    if (origin !== expectedOrigin)
      throw new Error('Artifact service changed. Review the destination and try again')
    if (!/^[A-Za-z0-9_-]{43}$/.test(grant.token) || grant.expiresAt <= Date.now())
      throw new Error('Invalid artifact sharing session')
    if (this.token !== token) throw new Error('Artifact publication cancelled')
    const response = await fetch(origin + '/v1/publications', {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok)
      throw new Error(
        response.status === 413
          ? 'Artifact storage limit reached. Delete a hosted copy or publish a smaller artifact'
          : 'Artifact publication failed. Try again; the same saved version will not create duplicate copies',
      )
    const result = decode(artifactPublicationResponseSchema, await response.json())
    if (this.token !== token)
      throw new Error(
        'Account changed. Sign in to the previous account to check its hosted publications',
      )
    this.publicationsRevision++
    this.set({
      publications: [
        ...(this.state.publications ?? []).filter((item) => item.id !== result.publication.id),
        { ...result.publication, sourceId: artifact.id },
      ],
      publicationOrigin: origin,
      publicationError: '',
    })
    return {
      publicationId: result.publication.id,
      url: origin + '/s/' + result.publication.id,
      manageUrl: origin + '/manage/' + result.publication.id + '#session=' + grant.token,
    }
  }
  enableArtifactFeed = async (
    publicationId: string,
    expectedOrigin: string,
    seconds: number,
    data: unknown,
    enable: (credential: ArtifactFeedCredential) => Promise<unknown>,
  ) => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in to approve a data feed')
    const encoded = JSON.stringify(data)
    if (encoded === undefined || new TextEncoder().encode(encoded).length > ARTIFACT_FEED_MAX_BYTES)
      throw new Error('Select JSON data smaller than 256 KB')
    const writer = decode(
      artifactFeedGrantSchema,
      await this.request('/v1/artifacts/feed-session', 'POST', { publicationId }, undefined, token),
    )
    const grant = decode(
      artifactGrantSchema,
      await this.request('/v1/artifacts/session', 'POST', undefined, undefined, token),
    )
    if (
      artifactServiceOrigin(writer.origin) !== expectedOrigin ||
      artifactServiceOrigin(grant.origin) !== expectedOrigin ||
      writer.publicationId !== publicationId ||
      !/^[A-Za-z0-9_-]{43}$/.test(writer.token) ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant.token) ||
      writer.expiresAt <= Date.now() ||
      grant.expiresAt <= Date.now()
    )
      throw new Error('Feed service changed or permission expired. Preview and approve again')
    if (this.token !== token) throw new Error('Account changed. Preview and approve again')
    const path = expectedOrigin + '/v1/publications/' + publicationId + '/feed'
    const response = await fetch(path, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writer: writer.token, seconds, data }),
    })
    if (!response.ok) throw new Error('Hosted feed setup failed')
    let generation: { generation: string }
    try {
      generation = decode(mutableStruct({ generation: uuidSchema }), await response.json())
    } catch (cause) {
      throw new Error(
        'Hosted feed setup response was invalid. Check sharing settings and clear the feed before trying again',
        { cause },
      )
    }
    const credential = decode(artifactFeedCredentialSchema, {
      ...writer,
      ...generation,
      connectOrigin: this.origin,
    })
    try {
      if (this.token !== token) throw new Error('Account changed. Preview and approve again')
      await enable(credential)
      if (this.token !== token) throw new Error('Account changed during feed setup')
    } catch (error) {
      try {
        const cleanup = await fetch(path, {
          method: 'DELETE',
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ generation: credential.generation }),
        })
        if (!cleanup.ok) throw new Error('Hosted feed cleanup rejected')
      } catch (cause) {
        throw new Error(
          'Feed setup failed and its hosted data could not be cleared. Stop the feed in sharing settings',
          { cause: new AggregateError([error, cause]) },
        )
      }
      throw error
    }
    return { generation: credential.generation }
  }
  stopArtifactFeed = async (publicationId: string, expectedOrigin: string, generation: string) => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in to stop the hosted feed')
    const grant = decode(
      artifactGrantSchema,
      await this.request('/v1/artifacts/session', 'POST', undefined, undefined, token),
    )
    if (
      artifactServiceOrigin(grant.origin) !== expectedOrigin ||
      this.token !== token ||
      grant.expiresAt <= Date.now()
    )
      throw new Error('Account or destination changed')
    const response = await fetch(expectedOrigin + '/v1/publications/' + publicationId + '/feed', {
      method: 'DELETE',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation }),
    })
    if (!response.ok) throw new Error('Could not stop the hosted feed. Use sharing settings')
  }
  /** Send the account session only to an owner-authorized local runtime to exchange it
   * for an installation-scoped grant. The runtime never persists this account session. */
  enableInternet = async (enable: (accountToken: string) => Promise<unknown>) => {
    if (!this.token || !this.state.directory) throw new Error('Sign in first')
    await enable(this.token)
    await this.refreshDirectory()
  }
  /** A paired runtime signs a session-bound registration. Only its restricted host grant
   * crosses the pairing; the full account session stays with this client and Connect. */
  enablePairedInternet = async (
    runtimeId: string,
    prepare: (sessionHash: string) => Promise<typeof internetSetupSchema.Type>,
    complete: (id: string, grant: string) => Promise<unknown>,
  ) => {
    const token = this.token
    if (!token || !this.state.directory || this.state.deletionPending)
      throw new Error('Sign in first')
    const setup = await prepare(Base64Url.encode(sha256(utf8ToBytes(token))))
    if (setup.registration.id !== runtimeId)
      throw new Error('Setup belongs to a different computer')
    if (this.token !== token) throw new Error('Account setup cancelled')
    const { grant } = decode(
      Schema.Struct({ grant: Schema.String }),
      await this.request('/v1/internet/hosts', 'PUT', setup.registration, undefined, token),
    )
    try {
      if (this.token !== token) throw new Error('Account setup cancelled')
      await complete(setup.id, grant)
      if (this.token !== token) throw new Error('Account setup cancelled')
    } catch (error) {
      try {
        await this.request('/v1/internet/host', 'DELETE', undefined, undefined, grant)
      } catch (cleanupError) {
        throw new Error(
          'Setup failed and its grant could not be revoked. Unlink this computer from your account.',
          { cause: cleanupError },
        )
      }
      throw error
    }
    await this.refreshDirectory()
  }
  connectInternet = async (
    server: AccountServer,
    secret: Uint8Array,
    signal: AbortSignal,
  ): Promise<RuntimeConnection> => {
    const token = this.token,
      session = this.sessionId()
    if (!token || !session || !this.state.directory || !server.internet)
      throw new Error('Sign in to connect')
    const request = decode(
      Schema.Struct({ id: Schema.String }),
      await this.request(
        '/v1/internet/connections',
        'POST',
        { runtimeId: server.id, publicKey: internetPublicKey(secret) },
        signal,
        token,
      ),
    )
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      if (signal.aborted || this.token !== token) throw new Error('Internet connection cancelled')
      const response = decode(
        Schema.Struct({ publicKey: Schema.String, box: Schema.NullOr(internetBoxSchema) }),
        await this.request(
          '/v1/internet/connections?id=' + encodeURIComponent(request.id),
          'GET',
          undefined,
          signal,
          token,
        ),
      )
      if (response.publicKey !== server.internet.publicKey)
        throw new Error(
          'Computer encryption key changed. Refresh your computers before connecting.',
        )
      if (response.box) {
        const value = decode(
          Schema.Struct({
            requestId: Schema.String,
            runtimeId: Schema.String,
            connection: connectionSchema,
          }),
          openInternet(response.box, response.publicKey, secret),
        )
        if (
          value.requestId !== request.id ||
          value.runtimeId !== server.id ||
          value.connection.runtimeId !== server.id ||
          !value.connection.peer ||
          value.connection.address !== peerAddress(value.connection.peer)
        )
          throw new Error('Encrypted connection belongs to a different computer or request')
        if (this.token !== token || signal.aborted) throw new Error('Internet connection cancelled')
        return { ...value.connection, accountSession: session }
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(new Error('Internet connection cancelled'))
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, 500)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    throw new Error(
      'Computer did not answer. Check that Dovo Connect is enabled and the computer is online.',
    )
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
    token = this.token,
  ) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 15_000)
    try {
      const response = await fetch(this.origin + path, {
        method,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (response.status === 409 && (path === '/v1/account' || path === '/v1/servers'))
        this.set({ deletionPending: true })
      if (!response.ok)
        throw new AccountError(
          response.status,
          /^\/v1\/(?:artifacts|sharing)\//.test(path)
            ? response.status === 401
              ? 'Sign in to use hosted artifact sharing.'
              : 'Hosted artifact sharing is not configured or is unavailable on this Connect broker.'
            : response.status === 401
              ? 'Sign in again to see your computers.'
              : response.status === 409
                ? 'Account deletion has started. Retry to finish deleting your account.'
                : 'Account service is unavailable. Please try again.',
        )
      const value: unknown = response.status === 204 ? null : await response.json()
      return value
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async work(run: () => Promise<void>) {
    if (this.state.busy) return
    this.set({ busy: true, error: '' })
    try {
      await run()
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        this.set({ error: error instanceof Error ? error.message : 'Account request failed.' })
    } finally {
      this.set({ busy: false, loaded: true })
    }
  }
  private setToken(token: string | null) {
    if (token !== this.token) {
      this.publicationsRevision++
      this.publicationsRequest = undefined
      this.set({
        directory: null,
        publications: null,
        publicationError: '',
        publicationOrigin: '',
        deletionPending: false,
      })
    }
    this.token = token
  }
  load = () =>
    this.work(async () => {
      const saved = await this.storage.read(this.origin)
      this.setToken(saved)
      if (this.token) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(this.token))
          throw new Error('Saved account session is invalid. Sign out and try again.')
        await this.refreshDirectory()
      }
    })
  async refreshDirectory(signal?: AbortSignal) {
    const token = this.token
    try {
      const directory = decode(
        accountDirectorySchema,
        await this.request('/v1/servers', 'GET', undefined, signal, token),
      )
      if (signal?.aborted || this.token !== token) throw new Error('Account refresh cancelled')
      this.set({ directory })
      return directory
    } catch (error) {
      if (
        !signal?.aborted &&
        error instanceof AccountError &&
        error.status === 401 &&
        this.token === token
      ) {
        await this.storage.write(null, this.origin)
        if (this.token === token) {
          this.setToken(null)
          this.set({ directory: null, publications: null, publicationError: '' })
        }
      }
      throw error
    }
  }
  refresh = () =>
    this.work(async () => {
      await this.refreshDirectory()
      await this.refreshPublications()
    })
  signIn = () =>
    this.work(async () => {
      const controller = new AbortController()
      this.controller = controller
      const login = decode(
        accountLoginSchema,
        await this.request('/v1/login', 'POST', undefined, controller.signal, null),
      )
      if (
        new URL(login.url).origin !== this.origin ||
        !login.url.startsWith(this.origin + '/auth/start?') ||
        !/^[A-Za-z0-9_-]{43}$/.test(login.token)
      )
        throw new Error('Invalid sign-in response')
      this.set({ login })
      try {
        await this.open(login.url)
        while (Date.now() < login.expiresAt && !controller.signal.aborted) {
          const status = decode(
            Schema.Struct({ ready: Schema.Boolean }),
            await this.request('/v1/login', 'GET', undefined, controller.signal, login.token),
          )
          if (controller.signal.aborted) return
          if (status.ready) {
            const directory = decode(
              accountDirectorySchema,
              await this.request('/v1/servers', 'GET', undefined, controller.signal, login.token),
            )
            if (controller.signal.aborted) return
            await this.storage.write(login.token, this.origin)
            if (controller.signal.aborted) {
              await this.storage.write(this.token, this.origin)
              return
            }
            this.setToken(login.token)
            this.set({ directory })
            return
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer)
              controller.signal.removeEventListener('abort', done)
              resolve()
            }
            const timer = setTimeout(done, 3000)
            controller.signal.addEventListener('abort', done, { once: true })
          })
        }
        if (!controller.signal.aborted) throw new Error('Sign-in expired. Please try again.')
      } finally {
        this.set({ login: null })
        this.controller = null
        if (this.token !== login.token)
          await this.request('/v1/session', 'DELETE', undefined, undefined, login.token)
      }
    })
  cancel = () => {
    this.controller?.abort()
  }
  signOut = () =>
    this.work(async () => {
      await this.request('/v1/session', 'DELETE')
      await this.storage.write(null, this.origin)
      this.setToken(null)
      this.set({
        directory: null,
        deletionPending: false,
        error: '',
        publications: null,
        publicationError: '',
      })
    })
  deleteAccount = () =>
    this.work(async () => {
      await this.request('/v1/account', 'DELETE', { confirm: 'DELETE' })
      this.setToken(null)
      this.set({
        directory: null,
        login: null,
        deletionPending: false,
        error: '',
        publications: null,
        publicationError: '',
      })
      await this.storage.write(null, this.origin)
    })
  subscribePush = async (registration: ManagedPushSubscription) => {
    if (!this.token || !this.state.directory)
      throw new Error('Sign in on this phone to enable managed push.')
    const grant = decode(
      managedPushGrantSchema,
      await this.request('/v1/push/subscriptions', 'PUT', registration),
    )
    return {
      token: grant.token,
      ...(this.origin !== ACCOUNT_DIRECTORY_URL ? { origin: this.origin } : {}),
    }
  }
  subscribeLiveActivity = async (registration: ManagedLiveActivity) => {
    if (!this.token || !this.state.directory)
      throw new Error('Sign in on this phone to enable managed Live Activity updates.')
    const grant = decode(
      managedPushGrantSchema,
      await this.request('/v1/push/activities', 'PUT', registration),
    )
    return {
      token: grant.token,
      ...(this.origin !== ACCOUNT_DIRECTORY_URL ? { origin: this.origin } : {}),
    }
  }
  retainLiveActivities = async (activities: Array<{ runtimeId: string; activityId: string }>) => {
    if (this.token) await this.request('/v1/push/activities/retain', 'PUT', { activities })
  }
  retainPush = async (runtimeIds: string[]) => {
    if (this.token) await this.request('/v1/push/servers', 'PUT', { runtimeIds })
  }
  link = (server: AccountServer) =>
    this.work(async () => {
      await this.request('/v1/servers', 'PUT', server)
      await this.refreshDirectory()
    })
  unlink = (id: string) =>
    this.work(async () => {
      await this.request('/v1/servers/' + encodeURIComponent(id), 'DELETE')
      await this.refreshDirectory()
    })
}
