import { type ManagedLiveActivity } from '../runtime/previews/live-activities.js'
import { Schema } from 'effect'
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
