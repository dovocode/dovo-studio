import { useRef, useState, useEffect } from 'react'
import {
  automationSchema,
  automationRestoreDraftSchema,
  decode,
  routineChangeSummary,
  restorableAutomation,
  type Automation,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Textarea,
} from '@dovo/studio-ui'

const drafts = new Map<string, { text: string; expected?: Automation }>()
export function RestoreDefinition({ runId }: { runId: string }) {
  const { connection } = useWorkspace()
  const scope = JSON.stringify([connection, runId])
  return <RestoreEditor key={scope} scope={scope} runId={runId} />
}
function RestoreEditor({ scope, runId }: { scope: string; runId: string }) {
  const { request, connected, connection, snapshot, flush, syncError } = useWorkspace()
  const [draft, updateDraft] = useState(drafts.get(scope)?.text ?? '')
  const setDraft = (text: string) => {
    if (text) drafts.set(scope, { ...drafts.get(scope), text })
    else drafts.delete(scope)
    updateDraft(text)
  }
  const [expected, updateExpected] = useState<Automation | undefined>(drafts.get(scope)?.expected)
  const setExpected = (value: Automation | undefined) => {
    const saved = drafts.get(scope)
    if (saved) drafts.set(scope, { ...saved, expected: value })
    updateExpected(value)
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  useEffect(
    () => () => {
      generation.current++
    },
    [connection, runId],
  )
  const act = async (operation: (version: number) => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    const version = generation.current
    try {
      await operation(version)
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      if (version === generation.current) setBusy(false)
    }
  }
  let changes: ReturnType<typeof routineChangeSummary> = []
  let valid = false
  try {
    const parsed = decode(automationSchema, JSON.parse(draft))
    valid = true
    changes = routineChangeSummary(
      expected,
      expected ? restorableAutomation(parsed, expected) : parsed,
    )
  } catch {
    /* Keep invalid JSON editable. */
  }
  return (
    <div className="space-y-2 border-b p-4">
      <Button
        size="sm"
        variant="outline"
        disabled={!connected || busy || !snapshot?.automationRestoreSupported}
        onClick={() =>
          void act(async (version) => {
            if (!drafts.has(scope) && drafts.size >= 40)
              throw new Error('Save or discard an existing restore draft before opening another.')
            await flush()
            if (version !== generation.current) return
            const result = await request(
              '/api/jobs/definition',
              { id: runId },
              automationRestoreDraftSchema,
            )
            if (version !== generation.current) return
            setDraft(JSON.stringify(result.definition, null, 2))
            setExpected(result.expected)
            setNotice('')
          })
        }
      >
        Restore definition from this run
      </Button>
      {!snapshot?.automationRestoreSupported && (
        <p className="text-xs text-muted-foreground">
          Update this computer to restore a run definition.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && !draft && <p role="alert">{error}</p>}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDraft('')
            setExpected(undefined)
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle>Restore automation definition</DialogTitle>
          <DialogDescription>
            Edit and compare this draft before saving. Current credentials stay in place. Automatic
            triggers will be paused. Running jobs keep their definitions.
          </DialogDescription>
          <Textarea
            aria-label="Restored automation definition"
            className="h-64 font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
          />
          <div className="max-h-40 overflow-y-auto text-xs" aria-label="Definition changes">
            {changes.map((change) => (
              <p key={change.label}>
                {change.label}: {change.before ?? 'None'} → {change.after ?? 'None'}
              </p>
            ))}
          </div>
          {!valid && <p role="alert">Enter a valid automation definition.</p>}
          {error && <p role="alert">{error}</p>}
          <Button
            variant="outline"
            disabled={busy || !connected}
            onClick={() =>
              void act(async (version) => {
                const latest = await request(
                  '/api/jobs/definition',
                  { id: runId },
                  automationRestoreDraftSchema,
                )
                if (version === generation.current) setExpected(latest.expected)
              })
            }
          >
            Compare with current definition
          </Button>
          <Button
            disabled={!valid || !expected || busy || !connected || !!syncError}
            onClick={() =>
              void act(async (version) => {
                const definition = decode(automationSchema, JSON.parse(draft))
                await flush()
                if (version !== generation.current) return
                await request(
                  '/api/jobs/restore',
                  { id: runId, expected, definition },
                  automationSchema,
                )
                if (version !== generation.current) return
                setDraft('')
                setExpected(undefined)
                setNotice('Definition restored. Automatic triggers are paused.')
              })
            }
          >
            Save restored definition
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
