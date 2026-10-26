import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'

const schema = Schema.Struct({
  helpers: Schema.Array(Schema.String),
  notifications: Schema.Record(Schema.String, Schema.Boolean),
})
type Permissions = Schema.Schema.Type<typeof schema>

/** Only the main process reads or writes approvals; website data never supplies these keys. */
export function browserPermissions(profileId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) throw new Error('Invalid browser profile.')
  const directory = join(app.getPath('userData'), 'browser-permissions')
  const path = join(directory, `${profileId}.json`)
  const read = (): Permissions => {
    try {
      return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { helpers: [], notifications: {} }
      throw new Error('Browser website and desktop application permissions could not be read.')
    }
  }
  const write = (next: Permissions) => {
    mkdirSync(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
    renameSync(temporary, path)
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
    notification: (origin: string) => read().notifications[origin],
    setNotification: (origin: string, allow: boolean) => {
      const current = read()
      write({ ...current, notifications: { ...current.notifications, [origin]: allow } })
    },
  }
}
