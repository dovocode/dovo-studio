import type { StateVersion } from '@dovo/durable-connections'
import { Result, Schema, Struct } from 'effect'
import {
  scopedSettingsValueSchema,
  sharedSettingsSchema,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
} from '../../workspace.js'
import { mergeSharedSettings } from './scoped-settings.js'

const categories = Struct.keys(scopedSettingsValueSchema.fields)

/** Each edited category has its own immutable version. Legacy whole-entry versions still load. */
export function sharedSettingsVersions(
  entries: readonly SharedSettingsEntry[],
): StateVersion<ScopedSettingsValue>[] {
  if (
    Result.isFailure(
      Schema.decodeUnknownResult(sharedSettingsSchema, {
        onExcessProperty: 'error',
      })(entries),
    )
  )
    throw new Error('Shared settings require a compatible app version; saved data was kept')
  return entries.flatMap((entry): StateVersion<ScopedSettingsValue>[] =>
    entry.revisions
      ? categories.flatMap((category) => {
          const revision = entry.revisions?.[category]
          return revision
            ? [
                {
                  key: `${entry.key}\n${category}`,
                  ...revision,
                  deleted: false as const,
                  value:
                    entry.value[category] === undefined
                      ? {}
                      : { [category]: entry.value[category] },
                },
              ]
            : []
        })
      : [{ ...entry, deleted: false as const }],
  )
}

export function sharedSettingsVersionEntry(
  version: StateVersion<ScopedSettingsValue>,
): SharedSettingsEntry {
  if (version.deleted) throw new Error('Shared settings use explicit reset values')
  const [key, category, extra] = version.key.split('\n')
  if (
    !key ||
    extra !== undefined ||
    (category !== undefined && !categories.some((name) => name === category))
  )
    throw new Error('Invalid shared settings category')
  if (category !== undefined && Object.keys(version.value).some((field) => field !== category))
    throw new Error('A shared category contains unrelated settings')
  return {
    key,
    updatedAt: version.updatedAt,
    changeId: version.changeId,
    value: version.value,
    ...(category === undefined
      ? {}
      : {
          revisions: { [category]: { updatedAt: version.updatedAt, changeId: version.changeId } },
        }),
  }
}

export function sharedSettingsFromVersions(versions: readonly StateVersion<ScopedSettingsValue>[]) {
  return mergeSharedSettings(versions.map(sharedSettingsVersionEntry))
}
