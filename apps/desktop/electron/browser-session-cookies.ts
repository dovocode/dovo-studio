import { safeStorage } from 'electron'
import { Schema } from 'effect'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cookieSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  hostOnly: Schema.Boolean,
  sameSite: Schema.Literals(['unspecified', 'no_restriction', 'lax', 'strict']),
  session: Schema.Literal(true),
})
const snapshotSchema = Schema.Array(cookieSchema)
const identity = (cookie: Electron.Cookie) =>
  JSON.stringify([cookie.domain, cookie.path, cookie.name])

type CookieSession = {
  storagePath: string | null
  cookies: Pick<Electron.Cookies, 'get' | 'set'> & {
    on(
      event: 'changed',
      listener: (
        event: Electron.Event,
        cookie: Electron.Cookie,
        cause: string,
        removed: boolean,
      ) => void,
    ): unknown
  }
}

/** Keep session cookies session-only, using an encrypted mirror for the next launch. */
export function createBrowserSessionCookies() {
  const sessions = new WeakMap<CookieSession, Promise<void>>()
  const refreshers = new Set<() => void>()
  const attach = (session: CookieSession, enabled: () => boolean = () => false) => {
    if (sessions.has(session)) return sessions.get(session) ?? undefined
    const directory = session.storagePath
    // Private partitions have no on-disk storage. Never fall back to plaintext encryption.
    if (!directory) return undefined
    const path = join(directory, 'dovo-session-cookies.enc')
    const canPersist = () => {
      if (!enabled()) {
        rmSync(path, { force: true })
        return false
      }
      if (
        !safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      ) {
        rmSync(path, { force: true })
        console.warn('Session cookies cannot survive restarts without OS credential storage.')
        return false
      }
      return true
    }
    const restore = async () => {
      let saved: readonly Schema.Schema.Type<typeof cookieSchema>[] = []
      try {
        if (canPersist())
          saved = Schema.decodeUnknownSync(snapshotSchema)(
            JSON.parse(safeStorage.decryptString(readFileSync(path))),
          )
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw new Error('Could not read saved browser session cookies.')
      }
      // Consume the old snapshot before using it: a failed restore cannot replay a stale login.
      rmSync(path, { force: true })
      const current = await session.cookies.get({})
      const existing = new Set(current.map(identity))
      for (const cookie of saved) {
        if (!enabled() || existing.has(identity(cookie))) continue
        const host = cookie.domain.replace(/^\./, '')
        await session.cookies.set({
          url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
          name: cookie.name,
          value: cookie.value,
          ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
        })
      }
      const cookies = new Map(
        (await session.cookies.get({ session: true })).map((cookie) => [identity(cookie), cookie]),
      )
      const persist = () => {
        if (!canPersist()) return
        if (!cookies.size) {
          rmSync(path, { force: true })
          return
        }
        mkdirSync(directory, { recursive: true })
        const temporary = `${path}.${randomUUID()}.tmp`
        try {
          writeFileSync(
            temporary,
            safeStorage.encryptString(JSON.stringify([...cookies.values()])),
            {
              mode: 0o600,
            },
          )
          renameSync(temporary, path)
        } finally {
          rmSync(temporary, { force: true })
        }
      }
      persist()
      refreshers.add(persist)
      session.cookies.on('changed', (_event, cookie, _cause, removed) => {
        if (removed || !cookie.session) cookies.delete(identity(cookie))
        else cookies.set(identity(cookie), cookie)
        try {
          persist()
        } catch {
          // Invalidate the previous snapshot rather than bringing back a deleted login.
          rmSync(path, { force: true })
          console.error('Could not save browser session cookies.')
        }
      })
    }
    const ready = restore()
    sessions.set(session, ready)
    return ready
  }
  return Object.assign(attach, {
    refresh() {
      for (const persist of refreshers) persist()
    },
  })
}

export function clearSavedBrowserSessionCookies(session: Pick<Electron.Session, 'storagePath'>) {
  if (session.storagePath)
    rmSync(join(session.storagePath, 'dovo-session-cookies.enc'), { force: true })
}
