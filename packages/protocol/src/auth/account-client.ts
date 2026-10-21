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
import { Base64Url } from 'effect/encoding'
import {
  managedPushGrantSchema,
  type ManagedPushSubscription,
} from '../runtime/push-notifications.js'
import { decode } from '../shared/schema.js'
import {
  ACCOUNT_DIRECTORY_URL,
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
}
class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
export class AccountClient {
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
  }
  constructor(
    private readonly storage: AccountStorage,
    private readonly open: (url: string) => Promise<unknown>,
    private readonly origin = ACCOUNT_DIRECTORY_URL,
  ) {}
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
  sessionId = () => (this.token ? bytesToHex(sha256(utf8ToBytes(this.token))) : null)
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
          response.status === 401
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
  load = () =>
    this.work(async () => {
      this.token = await this.storage.read()
      if (this.token) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(this.token))
          throw new Error('Saved account session is invalid. Sign out and try again.')
        await this.refreshDirectory()
      }
    })
  private async refreshDirectory() {
    try {
      this.set({ directory: decode(accountDirectorySchema, await this.request('/v1/servers')) })
    } catch (error) {
      if (error instanceof AccountError && error.status === 401) {
        await this.storage.write(null)
        this.token = null
        this.set({ directory: null })
      }
      throw error
    }
  }
  refresh = () => this.work(() => this.refreshDirectory())
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
            await this.storage.write(login.token)
            if (controller.signal.aborted) {
              await this.storage.write(this.token)
              return
            }
            this.token = login.token
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
      await this.storage.write(null)
      this.token = null
      this.set({ directory: null, deletionPending: false, error: '' })
    })
  deleteAccount = () =>
    this.work(async () => {
      await this.request('/v1/account', 'DELETE', { confirm: 'DELETE' })
      this.token = null
      this.set({ directory: null, login: null, deletionPending: false, error: '' })
      await this.storage.write(null)
    })
  subscribePush = async (registration: ManagedPushSubscription) => {
    if (!this.token || !this.state.directory)
      throw new Error('Sign in on this phone to enable managed push.')
    return decode(
      managedPushGrantSchema,
      await this.request('/v1/push/subscriptions', 'PUT', registration),
    )
  }
  subscribeLiveActivity = async (registration: ManagedLiveActivity) => {
    if (!this.token || !this.state.directory)
      throw new Error('Sign in on this phone to enable managed Live Activity updates.')
    return decode(
      managedPushGrantSchema,
      await this.request('/v1/push/activities', 'PUT', registration),
    )
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
