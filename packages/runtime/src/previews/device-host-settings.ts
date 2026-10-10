import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  deviceHostSettingsSchema,
  type DeviceHostSettings as SavedDeviceHostSettings,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { DeviceHost } from '@dovo/protocol'
export function sameDeviceHostConnection(a: DeviceHost, b: DeviceHost) {
  return (
    a.sshHost === b.sshHost &&
    a.sshUser === b.sshUser &&
    a.sshPort === b.sshPort &&
    a.runtimeAddress === b.runtimeAddress
  )
}
export function savedDeviceHostToken(host: DeviceHost, saved?: DeviceHost) {
  return host.token ?? (saved && sameDeviceHostConnection(host, saved) ? saved.token : undefined)
}
/** Tokens stay in the private, runtime-local database, never workspace sync/settings snapshots. */
export class DeviceHostSettings {
  constructor(private db: Database.Database) {}
  get(): SavedDeviceHostSettings {
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      this.db.prepare('SELECT value FROM documents WHERE id=?').get('device-hosts'),
    )
    const settings = decode(deviceHostSettingsSchema, row ? JSON.parse(row.value) : { hosts: [] })
    return { ...settings, enabled: settings.enabled ?? false, revision: settings.revision ?? 0 }
  }
  public() {
    const settings = this.get()
    return {
      ...settings,
      hosts: settings.hosts.map(({ token, ...host }) => ({ ...host, hasToken: !!token })),
    }
  }
  save(value: unknown) {
    const input = decode(deviceHostSettingsSchema, value)
    if (new Set(input.hosts.map((host) => host.id)).size !== input.hosts.length)
      throw new HttpError(400, 'Device host IDs must be unique')
    if (input.defaultHostId && !input.hosts.some((host) => host.id === input.defaultHostId))
      throw new HttpError(400, 'Default device host is not configured')
    const previous = this.get()
    if (input.revision !== undefined && input.revision !== previous.revision)
      throw new HttpError(409, 'Device host settings changed. Refresh before saving.')
    for (const host of input.hosts) {
      const saved = previous.hosts.find((entry) => entry.id === host.id)
      if (saved?.token && !host.token && !sameDeviceHostConnection(host, saved))
        throw new HttpError(409, 'Connection changed. Select a paired destination before saving.')
    }
    const settings = {
      ...input,
      enabled: input.enabled ?? previous.enabled ?? false,
      revision: (previous.revision ?? 0) + 1,
      hosts: input.hosts.map((host) => ({
        ...host,
        token: savedDeviceHostToken(
          host,
          previous.hosts.find((saved) => saved.id === host.id),
        ),
      })),
    }
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run('device-hosts', JSON.stringify(settings))
    return this.public()
  }
  remove(id: string) {
    const current = this.get()
    return this.save({
      ...current,
      hosts: current.hosts.filter((host) => host.id !== id),
      defaultHostId: current.defaultHostId === id ? undefined : current.defaultHostId,
    })
  }
}
