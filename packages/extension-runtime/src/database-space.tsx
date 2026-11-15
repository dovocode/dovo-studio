import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { databaseSpaceSchema, databaseSpaceRecoverySchema } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'

const mb = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`
export function DatabaseSpace() {
  const { request, connected } = useWorkspace()
  const uiText = useInterfaceText()
  const [space, setSpace] = useState<Schema.Schema.Type<typeof databaseSpaceSchema>>()
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (connected)
      void request('/api/runtime/storage', {}, databaseSpaceSchema).then(
        (result) => {
          if (active) setSpace(result)
        },
        (cause) => {
          if (active) setError(String(cause))
        },
      )
    return () => {
      active = false
    }
  }, [connected, request])
  const recover = async () => {
    setBusy(true)
    setError('')
    setStatus('')
    setReview(false)
    try {
      const result = await request(
        '/api/runtime/storage/recover',
        { confirm: true },
        databaseSpaceRecoverySchema,
      )
      setSpace(result.after)
      setStatus(`${uiText('Space recovery finished. Verified backup')}: ${result.backup.path}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label={uiText('Database space')}
      className="space-y-2 rounded-md border p-3 text-xs"
    >
      <h3 className="font-medium">{uiText('Database space')}</h3>
      {space && (
        <>
          <p>
            {uiText('Database')}: {mb(space.fileBytes)} · WAL: {mb(space.walBytes)}
          </p>
          <p>
            {uiText('Reclaimable pages')}: {mb(space.reclaimableBytes)} · {uiText('Disk free')}:{' '}
            {space.freeBytes === null ? uiText('Unavailable') : mb(space.freeBytes)}
          </p>
        </>
      )}
      <p className="text-muted-foreground">
        {uiText(
          'Recover unused pages without deleting history, settings or pairings. A verified backup needs extra disk space. Finish active work first. Requests pause briefly during recovery.',
        )}
      </p>
      {review ? (
        <div role="group" aria-label={uiText('Confirm space recovery')} className="flex gap-2">
          <Button size="sm" onClick={() => void recover()} disabled={busy || !connected}>
            {uiText('Create backup and recover')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReview(false)}>
            {uiText('Cancel')}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy || !space?.persistent || !space.reclaimableBytes}
          onClick={() => setReview(true)}
        >
          {uiText(busy ? 'Recovering space…' : 'Recover database space')}
        </Button>
      )}
      {status && (
        <p role="status" className="break-all">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
