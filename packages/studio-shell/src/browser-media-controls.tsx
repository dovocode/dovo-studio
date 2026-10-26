import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { decode, threadWindowTargetSchema, mutableArray, runtimeComputerName } from '@dovo/protocol'
import type { BrowserCommand, BrowserMediaRequest, BrowserCapture } from '@dovo/protocol'
import {
  Button,
  Checkbox,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

type Snapshot = { requests: BrowserMediaRequest[]; captures: BrowserCapture[] }
const sourceTypes = [
  { id: 'tab', label: 'Tabs' },
  { id: 'thread', label: 'Threads' },
  { id: 'window', label: 'Windows' },
  { id: 'screen', label: 'Screens' },
] as const
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Outside the Browser view: sharing remains visible when the user switches to a thread. */
export function BrowserMediaControls() {
  const { browser } = useStudioHost()
  const { runtimes } = useWorkspace()
  const threads = useMemo(
    () =>
      runtimes.flatMap((entry) =>
        entry.connected
          ? (entry.snapshot?.workspace.tasks ?? [])
              .filter((task) => !task.example && !task.archivedAt)
              .map((task) => ({
                runtimeId: entry.profile.id,
                taskId: task.id,
                title: task.title,
                computerName: runtimeComputerName(entry),
              }))
          : [],
      ),
    [runtimes],
  )
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
  const act = async (command: BrowserCommand, prepare?: () => Promise<unknown>) => {
    if (!browser || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await prepare?.()
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
                    ? 'Still sharing with '
                    : capture.state === 'starting'
                      ? 'Preparing to share with '
                      : capture.state === 'stopping'
                        ? 'Stopping sharing with '
                        : 'Sharing with '}
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
          threads={threads}
          busy={busy}
          error={error}
          onAnswer={(decision, source, audio, remember) => {
            const target = threads.find(
              (thread) => source === `thread:${thread.runtimeId}:${thread.taskId}`,
            )
            void act(
              {
                action: 'media',
                key: request.key,
                requestId: request.id,
                decision,
                source,
                audio,
                remember,
              },
              decision === 'allow' && target
                ? () =>
                    browser({
                      action: 'thread-media-sources',
                      key: 'studio-media',
                      sources: decode(mutableArray(threadWindowTargetSchema), [target]),
                    })
                : undefined,
            )
          }}
        />
      )}
    </>
  )
}

function MediaPermission({
  request,
  threads,
  busy,
  error,
  onAnswer,
}: {
  request: BrowserMediaRequest
  threads: readonly { runtimeId: string; taskId: string; title: string; computerName: string }[]
  busy: boolean
  error: string
  onAnswer: (
    decision: 'allow' | 'deny',
    source?: string,
    audio?: boolean,
    remember?: boolean,
  ) => void
}) {
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof sourceTypes)[number]['id']>('tab')
  const sources = [
    ...(request.sources ?? []).filter((item) => item.kind !== 'thread'),
    ...threads.map((thread) => ({
      key: `thread:${thread.runtimeId}:${thread.taskId}`,
      title: thread.title,
      url: thread.computerName,
      kind: 'thread' as const,
      audioSupported: false,
      requester: false,
    })),
  ]
  const matches = sources.filter(
    (item) =>
      (kind === 'tab'
        ? !item.kind || item.kind === 'tab' || item.kind === 'remote'
        : item.kind === kind) &&
      `${item.title} ${item.url} ${'profileId' in item ? item.profileId : ''} ${item.key}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  )

  const [audio, setAudio] = useState(false)
  const group = useId()
  const display = request.kind === 'display'
  const notifications = request.kind === 'notifications'
  const selected = sources.find((item) => item.key === source)
  const audioSupported = selected?.audioSupported !== false
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
        <DialogTitle>
          {display
            ? 'Choose what to share'
            : notifications
              ? 'Allow desktop notifications?'
              : `Allow ${devices}?`}
        </DialogTitle>
        <DialogDescription>
          <span className="break-all font-medium">{request.origin}</span>
          {display
            ? ' wants to share your screen. Choose what this website can see.'
            : notifications
              ? ' wants to send desktop notifications. Your choice is saved for this website in this browser profile.'
              : ` wants to use your ${devices} while this page is open.`}
        </DialogDescription>
        {request.kind === 'user-media' && (
          <p className="text-sm text-muted-foreground">
            Always allow remembers these devices for this website in this browser profile. Allow
            this time lasts until this page is closed or reloaded. Deny only rejects this request.
          </p>
        )}
        {display && (
          <>
            <Input
              aria-label="Search sharing sources"
              placeholder="Search tabs, threads, computers…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div
              role="tablist"
              aria-label="Sharing source type"
              className="flex min-w-0 gap-1 overflow-x-auto border-b"
            >
              {sourceTypes.map((type, index) => (
                <button
                  key={type.id}
                  type="button"
                  role="tab"
                  id={`${group}-tab-${type.id}`}
                  aria-controls={`${group}-sources`}
                  aria-selected={kind === type.id}
                  tabIndex={kind === type.id ? 0 : -1}
                  disabled={busy}
                  className={`shrink-0 border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring ${kind === type.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  onClick={() => {
                    if (kind === type.id) return
                    setKind(type.id)
                    setSource('')
                    setAudio(false)
                  }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? sourceTypes.length - 1
                          : (index + (event.key === 'ArrowRight' ? 1 : -1) + sourceTypes.length) %
                            sourceTypes.length
                    const target =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      )[next]
                    target?.click()
                    target?.focus({ preventScroll: true })
                    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                  }}
                >
                  {type.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${group}-sources`} aria-labelledby={`${group}-tab-${kind}`}>
              <fieldset disabled={busy} className="max-h-[40vh] space-y-2 overflow-y-auto">
                <legend className="sr-only">Choose a sharing source</legend>
                {matches.slice(0, 200).map((tab) => (
                  <label
                    key={tab.key}
                    className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name={group}
                      value={tab.key}
                      checked={source === tab.key}
                      onChange={() => {
                        setSource(tab.key)
                        setAudio(false)
                      }}
                      className="mt-1 shrink-0 accent-primary"
                    />
                    {'thumbnail' in tab && tab.thumbnail && (
                      <img
                        src={tab.thumbnail}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded object-contain"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {tab.title || tab.url}
                        {tab.requester ? ' (this tab)' : ''}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          tab.kind === 'remote'
                            ? 'Remote tab'
                            : tab.kind === 'thread'
                              ? 'Thread'
                              : tab.kind === 'screen'
                                ? 'Screen'
                                : tab.kind === 'window'
                                  ? 'Window'
                                  : 'Tab',
                          'profileId' in tab ? tab.profileId : undefined,
                          tab.url,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {matches.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">
                  {query
                    ? 'No matching sources.'
                    : `No ${sourceTypes.find((type) => type.id === kind)?.label.toLowerCase()} available.`}
                </p>
              )}
              {matches.length > 200 && (
                <p role="status" className="text-sm text-muted-foreground">
                  Showing 200 of {matches.length} matches. Refine your search to find another
                  source.
                </p>
              )}
            </div>
            {request.audio && audioSupported && (
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
        {request.sourceError && (
          <p role="alert" className="text-sm text-destructive">
            Windows and screens unavailable: {request.sourceError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onAnswer('deny')}>
            {request.kind === 'user-media' ? 'Deny' : 'Cancel'}
          </Button>
          {request.kind === 'user-media' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onAnswer('allow', undefined, undefined, false)}
            >
              Allow this time
            </Button>
          )}
          <Button
            disabled={busy || (display && !selected)}
            onClick={() =>
              onAnswer(
                'allow',
                display ? source : undefined,
                display && request.audio && audioSupported && audio,
                request.kind === 'user-media' ? true : undefined,
              )
            }
          >
            {display ? 'Share' : request.kind === 'user-media' ? 'Always allow' : 'Allow'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
