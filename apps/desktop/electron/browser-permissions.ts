import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import {
  isPrivateBrowserProfile,
  browserPermissionSettingSchema,
  type BrowserSitePermission,
  type BrowserPermissionSetting,
} from '@dovo/protocol'

const schema = Schema.Struct({
  helpers: Schema.Array(Schema.String),
  notifications: Schema.Record(Schema.String, Schema.Boolean),
  sites: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        notifications: Schema.optional(browserPermissionSettingSchema),
        microphone: Schema.optional(browserPermissionSettingSchema),
        camera: Schema.optional(browserPermissionSettingSchema),
        'clipboard-read': Schema.optional(browserPermissionSettingSchema),
        'clipboard-sanitized-write': Schema.optional(browserPermissionSettingSchema),
        'speaker-selection': Schema.optional(browserPermissionSettingSchema),
        'screen-wake-lock': Schema.optional(browserPermissionSettingSchema),
        'persistent-storage': Schema.optional(browserPermissionSettingSchema),
        'automatic-pip': Schema.optional(browserPermissionSettingSchema),
      }),
    ),
  ),
  media: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        audio: Schema.Boolean,
        video: Schema.Boolean,
      }),
    ),
  ),
})
type Permissions = Schema.Schema.Type<typeof schema>
const privatePermissions = new Map<string, Permissions>()
export function forgetPrivateBrowserPermissions(profileId: string) {
  privatePermissions.delete(profileId)
}

/** Only the main process reads or writes approvals; website data never supplies these keys. */
export function browserPermissions(profileId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) throw new Error('Invalid browser profile.')
  const directory = join(app.getPath('userData'), 'browser-permissions')
  const path = join(directory, `${profileId}.json`)
  const read = (): Permissions => {
    if (isPrivateBrowserProfile(profileId))
      return privatePermissions.get(profileId) ?? { helpers: [], notifications: {} }
    try {
      return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { helpers: [], notifications: {} }
      throw new Error('Browser website and desktop application permissions could not be read.')
    }
  }
  const write = (next: Permissions) => {
    if (isPrivateBrowserProfile(profileId)) {
      privatePermissions.set(profileId, next)
      return
    }
    mkdirSync(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
    renameSync(temporary, path)
  }
  const setting = (
    current: Permissions,
    origin: string,
    permission: BrowserSitePermission,
  ): BrowserPermissionSetting => {
    const explicit = current.sites?.[origin]?.[permission]
    if (explicit) return explicit
    if (permission === 'notifications') {
      const saved = current.notifications[origin]
      return saved === undefined ? 'ask' : saved ? 'allow' : 'block'
    }
    if (permission === 'automatic-pip') return 'block'
    if (permission === 'clipboard-sanitized-write' || permission === 'screen-wake-lock')
      return 'allow'
    if (permission !== 'camera' && permission !== 'microphone') return 'ask'
    return current.media?.[origin]?.[permission === 'camera' ? 'video' : 'audio'] ? 'allow' : 'ask'
  }
  return {
    helper: (key: string) => read().helpers.includes(key),
    allowHelper: (key: string) => {
      const current = read()
      write({ ...current, helpers: [...new Set([...current.helpers, key])] })
    },
    revokeHelpers: (extensionId: string) => {
      const current = read()
      write({
        ...current,
        helpers: current.helpers.filter((key) => !key.startsWith(`${extensionId}:`)),
      })
    },
    site: (origin: string) => {
      const current = read()
      return {
        origin,
        permissions: {
          notifications: setting(current, origin, 'notifications'),
          microphone: setting(current, origin, 'microphone'),
          camera: setting(current, origin, 'camera'),
          'clipboard-read': setting(current, origin, 'clipboard-read'),
          'clipboard-sanitized-write': setting(current, origin, 'clipboard-sanitized-write'),
          'speaker-selection': setting(current, origin, 'speaker-selection'),
          'screen-wake-lock': setting(current, origin, 'screen-wake-lock'),
          'persistent-storage': setting(current, origin, 'persistent-storage'),
          'automatic-pip': setting(current, origin, 'automatic-pip'),
        },
      }
    },
    setSite: (
      origin: string,
      permission: BrowserSitePermission,
      value: BrowserPermissionSetting,
    ) => {
      const current = read()
      write({
        ...current,
        sites: { ...current.sites, [origin]: { ...current.sites?.[origin], [permission]: value } },
      })
    },
    notification: (origin: string) => {
      const value = setting(read(), origin, 'notifications')
      return value === 'ask' ? undefined : value === 'allow'
    },
    media: (origin: string) => {
      const current = read()
      if (!current.media?.[origin] && !current.sites?.[origin]) return undefined
      return {
        audio: setting(current, origin, 'microphone') === 'allow',
        video: setting(current, origin, 'camera') === 'allow',
      }
    },
    allowMedia: (origin: string, types: { audio: boolean; video: boolean }) => {
      const current = read()
      write({
        ...current,
        sites: {
          ...current.sites,
          [origin]: {
            ...current.sites?.[origin],
            ...(types.audio ? { microphone: 'allow' as const } : {}),
            ...(types.video ? { camera: 'allow' as const } : {}),
          },
        },
      })
    },
    setNotification: (origin: string, allow: boolean) => {
      const current = read()
      write({
        ...current,
        sites: {
          ...current.sites,
          [origin]: { ...current.sites?.[origin], notifications: allow ? 'allow' : 'block' },
        },
      })
    },
  }
}
