import { useState, useRef, useEffect } from 'react'
import { runAuditSchema } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import type { Schema } from 'effect'

export function RunAudit({ runId }: { runId: string }) {
  const { request, connection, connected } = useWorkspace()
  const [audit, setAudit] = useState<Schema.Schema.Type<typeof runAuditSchema>>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setAudit(undefined)
    setError('')
    setBusy(false)
  }, [runId, connection])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const load = async (next: number, output = false) => {
    const version = ++generation.current
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/jobs/audit',
        { id: runId, offset: next, output },
        runAuditSchema,
      )
      if (version === generation.current) {
        setAudit(result)
        setOffset(next)
      }
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (version === generation.current) setBusy(false)
    }
  }
  return (
    <section className="grid gap-2 border-t p-4 text-xs" aria-label="Run audit">
      <p>
        Run audit includes this run's workers. Usage is an estimate, not a subscription bill.
        Retained output loads only when requested.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() => void load(0)}
        >
          Load audit
        </Button>
        {audit && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!connected || busy}
              onClick={() => void load(offset, true)}
            >
              Load output for this page
            </Button>
            {audit.nextOffset !== undefined && (
              <Button
                size="sm"
                variant="outline"
                disabled={!connected || busy}
                onClick={() => {
                  if (audit.nextOffset !== undefined) void load(audit.nextOffset)
                }}
              >
                Next page
              </Button>
            )}
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {audit && (
        <>
          <p>
            {audit.tokens} reported tokens · ${audit.estimatedCostUsd.toFixed(4)} estimated
            {audit.usageIncomplete ? ' · Some usage is unavailable' : ''}
          </p>
          <p>
            Page {Math.floor(offset / 100) + 1}
            {audit.nextOffset !== undefined ? ' · More events available' : ''}. Select and copy this
            JSON to export this page.
          </p>
          <textarea
            readOnly
            aria-label="Run audit JSON"
            className="h-64 w-full rounded border bg-background p-2 font-mono text-xs"
            value={JSON.stringify(audit, null, 2)}
          />
        </>
      )}
    </section>
  )
}
