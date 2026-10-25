import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { useStudioHost } from '@dovo/studio-core'
import type { BrowserCommand, BrowserMediaRequest, BrowserCapture } from '@dovo/protocol'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

type Snapshot = { requests: BrowserMediaRequest[]; captures: BrowserCapture[] }
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Outside the Browser view: sharing remains visible when the user switches to a thread. */
export function BrowserMediaControls() {
  const { browser } = useStudioHost()
  const [snapshot, setSnapshot] = useState<Snapshot>({ requests: [], captures: [] })
  const [pollError, setPollError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const signature = useRef('')
  const refreshSequence = useRef(0)
  const refresh = useCallback(async () => {
    if (!browser) return
    const sequence = ++refreshSequence.current
    const result = await browser({ action: 'media-status', key: 'studio-media' })
    if (sequence !== refreshSequence.current) return
    const next = { requests: result?.mediaRequests ?? [], captures: result?.captures ?? [] }
    const nextSignature = JSON.stringify(next)
    if (signature.current !== nextSignature) {
      signature.current = nextSignature
      setSnapshot(next)
    }
    setPollError('')
  }, [browser])
  useEffect(() => {
    if (!browser) return
    const polling = startPolling(Effect.tryPromise({ try: refresh, catch: message }), {
      interval: 1000,
      onError: (cause) => setPollError(`Browser sharing status unavailable: ${cause}`),
    })
    return () => {
      refreshSequence.current++
      void polling.stop()
    }
  }, [browser, refresh])
  const act = async (command: BrowserCommand) => {
    if (!browser || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await browser(command)
      await refresh()
    } catch (cause) {
      setError(message(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const request = snapshot.requests[0]
  useEffect(() => setError(''), [request?.id])
  if (!browser) return null
  return (
    <>
      {snapshot.captures.length > 0 && (
        <aside
          aria-label="Browser tab sharing"
          className="shrink-0 space-y-2 border-b bg-card px-4 py-2"
        >
          {snapshot.captures.map((capture) => (
            <div
              key={capture.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0 space-y-1 text-xs">
                <p role="status">
                  {capture.unresponsive
                    ? 'Still sharing a browser tab with '
                    : capture.state === 'starting'
                      ? 'Preparing to share a tab with '
                      : capture.state === 'stopping'
                        ? 'Stopping tab sharing with '
                        : 'Sharing a browser tab with '}
                  <span className="break-all font-medium">{capture.origin}</span>
                  {capture.audio ? ' · tab audio included' : ''}
                </p>
                {(capture.sourceTitle || capture.sourceUrl) && (
                  <p className="truncate text-muted-foreground" title={capture.sourceUrl}>
                    {capture.sourceTitle || capture.sourceUrl}
                  </p>
                )}
                {capture.unresponsive && (
                  <p role="alert" className="text-destructive">
                    Sharing is still active. Try stopping again, or close the sharing website’s tab.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || (capture.state === 'stopping' && !capture.unresponsive)}
                onClick={() =>
                  void act({ action: 'stop-capture', key: capture.key, captureId: capture.id })
                }
              >
                Stop sharing
              </Button>
            </div>
          ))}
        </aside>
      )}
      {(pollError || (error && !request)) && (
        <p role="alert" className="shrink-0 border-b px-4 py-2 text-xs text-destructive">
          {pollError || error}
        </p>
      )}
      {request && (
        <MediaPermission
          key={request.id}
          request={request}
          busy={busy}
          error={error}
          onAnswer={(decision, source, audio) =>
            void act({
              action: 'media',
              key: request.key,
              requestId: request.id,
              decision,
              source,
              audio,
            })
          }
        />
      )}
    </>
  )
}

function MediaPermission({
  request,
  busy,
  error,
  onAnswer,
}: {
  request: BrowserMediaRequest
  busy: boolean
  error: string
  onAnswer: (decision: 'allow' | 'deny', source?: string, audio?: boolean) => void
}) {
  const [source, setSource] = useState('')
  const [audio, setAudio] = useState(false)
  const group = useId()
  const display = request.kind === 'display'
  const devices = [request.video ? 'camera' : '', request.audio ? 'microphone' : '']
    .filter(Boolean)
    .join(' and ')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onAnswer('deny')
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>{display ? 'Share a browser tab' : `Allow ${devices}?`}</DialogTitle>
        <DialogDescription>
          <span className="break-all font-medium">{request.origin}</span>
          {display
            ? ' wants to share a tab. Choose what this website can see.'
            : ` wants to use your ${devices} while this page is open.`}
        </DialogDescription>
        {display && (
          <>
            <fieldset disabled={busy} className="max-h-[40vh] space-y-2 overflow-y-auto">
              <legend className="mb-2 text-xs text-muted-foreground">
                Tabs in this window and browser profile
              </legend>
              {(request.sources ?? []).map((tab) => (
                <label
                  key={tab.key}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent"
                >
                  <input
                    type="radio"
                    name={group}
                    value={tab.key}
                    checked={source === tab.key}
                    onChange={() => setSource(tab.key)}
                    className="mt-1 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {tab.title || tab.url}
                      {tab.requester ? ' (this tab)' : ''}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{tab.url}</span>
                  </span>
                </label>
              ))}
              {!request.sources?.length && (
                <p className="text-sm text-muted-foreground">
                  Open a tab in this browser profile to share it.
                </p>
              )}
            </fieldset>
            {request.audio && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={audio}
                  disabled={busy}
                  onCheckedChange={(value) => setAudio(value === true)}
                />
                Share tab audio
              </label>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onAnswer('deny')}>
            Cancel
          </Button>
          <Button
            disabled={busy || (display && !request.sources?.some((tab) => tab.key === source))}
            onClick={() =>
              onAnswer('allow', display ? source : undefined, display && request.audio && audio)
            }
          >
            {display ? 'Share tab' : 'Allow'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
