import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  usageStorageSchema,
  usageExportSchema,
  runtimeComputerName,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { copyText } from '../ui/content/clipboard'
import { Text } from '../ui/content/text'
import { SettingsAction as Action, SettingsField as Field } from './settings-controls'
import { SettingsGroup } from './settings-group'
import { useSettingsTheme } from './settings-theme'

export function UsageStorage({ computer }: { computer: string }) {
  const { overviews } = useRuntime()
  return (
    <SettingsGroup
      title="Stored usage history"
      footer="Keep all records by default. Retention deletes old usage records only. It leaves threads and provider transcripts intact. Export first to keep a copy. Clear the days field and save to turn cleanup off."
    >
      {overviews
        .filter((entry) => computer === 'all' || entry.profile.id === computer)
        .map((entry) => (
          <StorageRow key={entry.profile.id} entry={entry} />
        ))}
    </SettingsGroup>
  )
}
function StorageRow({ entry }: { entry: RuntimeOverview }) {
  const { readRuntime } = useRuntime()
  const { styles } = useSettingsTheme()
  const [value, setValue] = useState<typeof usageStorageSchema.Type>()
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cursor, setCursor] = useState<(typeof usageExportSchema.Type)['next']>()
  const [shared, setShared] = useState<{ next?: typeof cursor }>()
  const supported = !!entry.snapshot?.usageRetentionSupported
  useEffect(() => {
    if (!entry.connected || !supported) return
    let alive = true
    void readRuntime(entry.profile, '/api/usage/storage/read', {}, usageStorageSchema).then(
      (result) => {
        if (alive) {
          setValue(result)
          setDays(result.days?.toString() ?? '')
        }
      },
      (error: unknown) => {
        if (alive) setMessage(String(error))
      },
    )
    return () => {
      alive = false
    }
  }, [entry.profile, entry.connected, supported, readRuntime])
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await operation()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const disabled = busy || !supported || !entry.connected
  return (
    <View style={{ padding: 12, gap: 8 }}>
      <Text style={styles.text}>{runtimeComputerName(entry)}</Text>
      {!supported ? (
        <Text style={styles.muted}>Update this computer to manage stored usage history.</Text>
      ) : (
        <>
          <Text style={styles.muted}>
            {value
              ? `${value.count} records · ${value.oldest ?? 'No records'} to ${value.newest ?? 'No records'} · ${value.days === null ? 'Keep all' : `Keep ${value.days} days`}`
              : 'Connect to load stored history.'}
          </Text>
          <Field
            label="Usage retention days"
            placeholder="Keep all"
            keyboardType="number-pad"
            value={days}
            editable={!disabled}
            onChangeText={setDays}
          />
          <Action
            label="Save retention and delete old usage records"
            disabled={disabled}
            onPress={() =>
              void act(async () => {
                const count = days.trim() ? Number(days) : null
                if (count !== null && (!Number.isInteger(count) || count < 1 || count > 36500))
                  throw new Error('Enter 1 to 36500 days, or leave blank to keep all.')
                setValue(
                  await readRuntime(
                    entry.profile,
                    '/api/usage/storage/write',
                    { days: count },
                    usageStorageSchema,
                  ),
                )
                setCursor(undefined)
                setShared(undefined)
                setMessage('Retention saved. Deleted records cannot be restored here.')
              })
            }
          />
          <Action
            secondary
            label={`Copy ${cursor ? 'next' : 'first'} export page, up to 256 records`}
            disabled={disabled}
            onPress={() =>
              void act(async () => {
                const result = await readRuntime(
                  entry.profile,
                  '/api/usage/storage/export',
                  { cursor },
                  usageExportSchema,
                )
                const delivery = await copyText(JSON.stringify(result, null, 2) + '\n')
                if (delivery === 'shared') {
                  setShared({ next: result.next })
                  setMessage(
                    'Share sheet opened. Keep a copy before continuing. This page remains available.',
                  )
                  return
                }
                setShared(undefined)
                setCursor(result.next)
                setMessage(
                  result.next
                    ? 'Page copied as JSON. Copy the next page to continue.'
                    : 'Last page copied as JSON. The next export starts again.',
                )
              })
            }
          />
          {shared && (
            <Action
              secondary
              label={shared.next ? 'Continue to next export page' : 'Start export again'}
              disabled={disabled}
              onPress={() => {
                setCursor(shared.next)
                setShared(undefined)
                setMessage(
                  shared.next
                    ? 'Ready to export the next page.'
                    : 'Ready to export the first page.',
                )
              }}
            />
          )}
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {message}
        </Text>
      )}
    </View>
  )
}
