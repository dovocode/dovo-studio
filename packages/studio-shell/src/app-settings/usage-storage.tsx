import { useEffect, useState } from 'react'
import {
  usageStorageSchema,
  usageExportSchema,
  runtimeComputerName,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

export function UsageStorage({ computer }: { computer: string }) {
  const { runtimes } = useWorkspace()
  return (
    <section className="space-y-3 rounded-lg border p-4 text-xs">
      <h2 className="text-sm font-medium">Stored usage history</h2>
      <p>
        Keep all records by default. Export stored records from any date, including records older
        than the 90-day chart. Retention cleanup deletes old usage records only. It does not delete
        threads or provider transcripts.
      </p>
      {runtimes
        .filter((entry) => computer === 'all' || computer === entry.profile.id)
        .map((entry) => (
          <StorageRow key={entry.profile.id} entry={entry} />
        ))}
    </section>
  )
}
function StorageRow({ entry }: { entry: RuntimeOverview }) {
  const { readRuntime } = useWorkspace()
  const [value, setValue] = useState<typeof usageStorageSchema.Type>()
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cursor, setCursor] = useState<(typeof usageExportSchema.Type)['next']>()
  const [page, setPage] = useState(1)
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
  const disabled = busy || !entry.connected || !supported
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-medium">{runtimeComputerName(entry)}</p>
      {!supported ? (
        <p>Update this computer to manage stored usage history.</p>
      ) : (
        <>
          <p>
            {value
              ? `${value.count} records · ${value.oldest ?? 'No records'} to ${value.newest ?? 'No records'} · ${value.days === null ? 'Keep all' : `Keep ${value.days} days`}`
              : 'Connect to load stored history.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              aria-label="Usage retention days"
              type="number"
              min={1}
              max={36500}
              placeholder="Keep all"
              value={days}
              disabled={disabled}
              onChange={(event) => setDays(event.target.value)}
            />
            <Button
              disabled={disabled}
              onClick={() =>
                void act(async () => {
                  const count = days.trim() ? Number(days) : null
                  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 36500))
                    throw new Error('Enter 1 to 36500 days, or leave blank to keep all.')
                  const result = await readRuntime(
                    entry.profile,
                    '/api/usage/storage/write',
                    { days: count },
                    usageStorageSchema,
                  )
                  setValue(result)
                  setCursor(undefined)
                  setPage(1)
                  setMessage('Retention saved. Old records were deleted when a limit was set.')
                })
              }
            >
              Save retention and clean up
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void act(async () => {
                  const result = await readRuntime(
                    entry.profile,
                    '/api/usage/storage/export',
                    { cursor },
                    usageExportSchema,
                  )
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(result, null, 2) + '\n'], {
                      type: 'application/json',
                    }),
                  )
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `dovo-usage-${result.sourceId}-${page}.json`
                  link.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                  setCursor(result.next)
                  setPage(result.next ? page + 1 : 1)
                  setMessage(
                    result.next
                      ? 'Page exported. Export the next page to continue.'
                      : 'Last page exported. The next export starts again.',
                  )
                })
              }
            >
              Export {cursor ? 'next' : 'first'} page, up to 256 records
            </Button>
          </div>
          <p>
            Clear the days field and save to turn cleanup off. Deleted records cannot be restored
            here. Export first to keep a copy.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  )
}
