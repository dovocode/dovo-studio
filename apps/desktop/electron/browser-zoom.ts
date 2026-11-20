import { app } from 'electron'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { isPrivateBrowserProfile } from '@dovo/protocol'
import { readBrowserProfileStore } from './browser-profile-store.js'

export const browserZoomSteps = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
]
export function nextBrowserZoom(current: number, direction: 'in' | 'out' | 'reset') {
  if (direction === 'reset') return 1
  return direction === 'in'
    ? (browserZoomSteps.find((value) => value > current + 0.001) ?? 5)
    : (browserZoomSteps.findLast((value) => value < current - 0.001) ?? 0.25)
}
const factorSchema = Schema.Number.pipe(
  Schema.check(Schema.isBetween({ minimum: 0.25, maximum: 5 })),
)
const schema = Schema.Record(Schema.String, factorSchema)
/** Keep each site whose saved zoom is still a valid factor. */
const salvage = (value: unknown): Record<string, number> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, number] =>
          Schema.is(factorSchema)(entry[1]),
        ),
      )
    : {}
export function createBrowserZoom() {
  const profiles = new Map<string, Record<string, number>>()
  const directory = join(app.getPath('userData'), 'browser-zoom')
  const write = (profile: string, values: Record<string, number>) => {
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${profile}.json`),
      temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 })
    renameSync(temporary, path)
  }
  const read = (profile: string) => {
    const existing = profiles.get(profile)
    if (existing) return existing
    let values: Record<string, number> = {}
    if (!isPrivateBrowserProfile(profile)) {
      try {
        values = {
          ...readBrowserProfileStore(
            join(directory, `${profile}.json`),
            Schema.decodeUnknownSync(schema),
            salvage,
            (recovered) => write(profile, recovered),
          ),
        }
      } catch (error) {
        throw new Error('Could not read browser zoom settings.', { cause: error })
      }
    }
    profiles.set(profile, values)
    return values
  }
  const origin = (url: string) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : undefined
    } catch {
      return undefined
    }
  }
  return {
    get(profile: string, url: string) {
      const site = origin(url)
      return site ? (read(profile)[site] ?? 1) : 1
    },
    set(profile: string, url: string, factor: number) {
      const site = origin(url)
      if (!site) return
      const values = { ...read(profile) }
      if (factor === 1) delete values[site]
      else values[site] = factor
      if (!isPrivateBrowserProfile(profile)) write(profile, values)
      profiles.set(profile, values)
    },
    forget(profile: string) {
      profiles.delete(profile)
    },
  }
}
