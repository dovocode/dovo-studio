import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  randomUUID,
  remoteDesktopResponseSchema,
  type RemoteDesktopFrame,
  type RemoteDesktopInput,
  type RemoteDesktopRequest,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { HostPage } from './host-page'
import { RemoteDesktopPreferences } from './runtime-preferences'

export default function RemoteDesktopView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Remote desktop"
      description="Experimental access to this computer’s primary display through Cua Driver."
    >
      <RemoteDesktopPreferences />
      <RemoteDesktopViewer />
    </HostPage>
  )
}
export function RemoteDesktopViewer() {
  const { request, connected, snapshot } = useWorkspace()
  const [id, setId] = useState<string | null>(null)
  const [control, setControl] = useState(false)
  const [frame, setFrame] = useState<RemoteDesktopFrame | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [text, setText] = useState('')
  const live = useRef({
    id: null as string | null,
    busy: false,
    stopping: false,
    generation: 0,
    frame: null as RemoteDesktopFrame | null,
    control: false,
    error: false,
  })
  const queue = useRef<RemoteDesktopInput[]>([])
  const drain = useRef<() => void>(() => {})
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickPoint = useRef<{ x: number; y: number } | null>(null)
  const moveAt = useRef(0)
  const imageElement = useRef<HTMLImageElement>(null)
  const wheelInput = useRef<(event: WheelEvent) => void>(() => {})
  const currentRequest = useRef(request)
  currentRequest.current = request
  useEffect(() => {
    const state = live.current
    return () => {
      state.generation++
      queue.current = []
      if (clickTimer.current) clearTimeout(clickTimer.current)
      if (state.id)
        void currentRequest
          .current(
            '/api/remote-desktop',
            { action: 'stop', id: state.id },
            remoteDesktopResponseSchema,
          )
          .catch((cause) =>
            console.error(
              'Remote desktop stop could not be confirmed; host expiry will end the session.',
              cause,
            ),
          )
      state.id = null
    }
  }, [])
  const send = async (input: RemoteDesktopRequest) => {
    const state = live.current
    if (state.busy || state.stopping) return
    state.busy = true
    setBusy(true)
    const version = state.generation
    try {
      const result = await request('/api/remote-desktop', input, remoteDesktopResponseSchema)
      if (version !== state.generation) return
      state.control = result.session?.control ?? false
      setControl(state.control)
      if (result.frame) {
        state.frame = result.frame
        state.error = false
        setFrame(result.frame)
        setError('')
      }
    } catch (cause) {
      if (version === state.generation) {
        setError(cause instanceof Error ? cause.message : String(cause))
        state.control = false
        state.error = true
        queue.current = []
        setControl(false)
      }
    } finally {
      if (version === state.generation) {
        state.busy = false
        setBusy(false)
        queueMicrotask(() => drain.current())
      }
    }
  }
  const stop = async () => {
    const state = live.current
    if (!state.id || state.stopping) return
    state.stopping = true
    state.control = false
    queue.current = []
    if (clickTimer.current) clearTimeout(clickTimer.current)
    pointer.current = null
    setStopping(true)
    setControl(false)
    const version = ++state.generation
    try {
      await request(
        '/api/remote-desktop',
        { action: 'stop', id: state.id },
        remoteDesktopResponseSchema,
      )
      if (version !== state.generation) return
      state.id = null
      setId(null)
      setFrame(null)
      setError('')
    } catch (cause) {
      if (version === state.generation)
        setError(`Stop not confirmed: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      if (version === state.generation) {
        state.stopping = false
        state.busy = false
        setStopping(false)
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (!id || error || !connected || stopping) return
    const timer = setInterval(() => {
      if (!document.hidden && !pointer.current && !clickTimer.current && !queue.current.length)
        void send({ action: 'frame', id })
    }, 750)
    return () => clearInterval(timer)
  }, [id, error, connected, stopping, request])
  drain.current = () => {
    const state = live.current
    if (
      state.busy ||
      state.stopping ||
      state.error ||
      !state.control ||
      !connected ||
      !state.id ||
      !state.frame
    )
      return
    const value = queue.current.shift()
    if (value)
      void send({
        action: 'input',
        id: state.id,
        requestId: randomUUID(),
        frameId: state.frame.id,
        input: value,
      })
  }
  const input = (value: RemoteDesktopInput) => {
    const state = live.current
    if (!state.id || !state.frame || !state.control || state.error || !connected) return
    if (value.type !== 'move') queue.current = queue.current.filter((item) => item.type !== 'move')
    const last = queue.current.at(-1)
    if (
      value.type === 'text' &&
      last?.type === 'text' &&
      last.text.length + value.text.length <= 4000
    )
      last.text += value.text
    else if (value.type === 'move' && last?.type === 'move')
      queue.current[queue.current.length - 1] = value
    else if (queue.current.length < 50) queue.current.push(value)
    else {
      queue.current = []
      state.error = true
      state.control = false
      setControl(false)
      setError('Input queue is full. Refresh the desktop before continuing.')
      return
    }
    drain.current()
  }
  const point = (event: { currentTarget: HTMLImageElement; clientX: number; clientY: number }) => {
    if (!frame) return { x: 0, y: 0 }
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(frame.width - 1, ((event.clientX - bounds.left) * frame.width) / bounds.width),
      ),
      y: Math.max(
        0,
        Math.min(frame.height - 1, ((event.clientY - bounds.top) * frame.height) / bounds.height),
      ),
    }
  }
  const key = (event: KeyboardEvent<HTMLImageElement>) => {
    if (
      !control ||
      event.key === 'Tab' ||
      ['Shift', 'Control', 'Alt', 'Meta', 'Dead', 'Unidentified'].includes(event.key)
    )
      return
    event.preventDefault()
    const names: Record<string, string> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ' ': 'space',
      Escape: 'escape',
      Backspace: 'backspace',
      Enter: 'return',
      Delete: 'delete',
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      input({ type: 'text', text: event.key })
      return
    }
    const modifiers: Array<'cmd' | 'ctrl' | 'alt' | 'shift'> = []
    if (event.metaKey) modifiers.push('cmd')
    if (event.ctrlKey) modifiers.push('ctrl')
    if (event.altKey) modifiers.push('alt')
    if (event.shiftKey) modifiers.push('shift')
    input({ type: 'key', key: names[event.key] ?? event.key.toLowerCase(), modifiers })
  }

  wheelInput.current = (event: WheelEvent) => {
    const image = imageElement.current
    if (!image || !live.current.control || live.current.error) return
    event.preventDefault()
    input({
      type: 'scroll',
      ...point({ currentTarget: image, clientX: event.clientX, clientY: event.clientY }),
      direction:
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX > 0
            ? 'right'
            : 'left'
          : event.deltaY > 0
            ? 'down'
            : 'up',
      amount: Math.max(
        1,
        Math.min(10, Math.ceil(Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) / 60)),
      ),
    })
  }
  useEffect(() => {
    const image = imageElement.current
    if (!image) return
    const handle = (event: WheelEvent) => wheelInput.current(event)
    image.addEventListener('wheel', handle, { passive: false })
    return () => image.removeEventListener('wheel', handle)
  }, [id, !!frame])
  const start = () => {
    const next = live.current.id ?? randomUUID()
    live.current.id = next
    live.current.error = false
    setId(next)
    setError('')
    void send({ action: 'start', id: next })
  }
  if (snapshot?.remoteDesktopEnabled !== true)
    return (
      <p className="text-sm text-muted-foreground">
        Enable experimental remote desktop above to connect. Set up Cua Driver and grant OS screen
        recording and input permissions in Computer use settings on the host.
      </p>
    )
  return (
    <section aria-label="Remote desktop" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Primary display · Shared desktop · No audio, clipboard sync or file transfer. Enabling
        control sends input to the host’s visible desktop.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!id ? (
          <Button disabled={!connected || busy} onClick={start}>
            Connect to desktop
          </Button>
        ) : (
          <>
            <span role="status" className="text-xs font-medium">
              {stopping ? 'Stopping…' : control ? 'Controlling desktop' : 'Viewing desktop'}
            </span>
            <Button
              variant="outline"
              disabled={!connected || busy || stopping || !!error || !frame}
              onClick={() => void send({ action: 'control', id, enabled: !control })}
            >
              {control ? 'Switch to view only' : 'Enable control'}
            </Button>
            <Button
              variant="outline"
              disabled={!connected || busy || stopping}
              onClick={() => (frame ? void send({ action: 'frame', id }) : start())}
            >
              Refresh desktop
            </Button>
            <Button
              variant="destructive"
              disabled={stopping || !connected}
              onClick={() => void stop()}
            >
              Stop sharing
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!connected && id && (
        <p role="alert" className="text-sm text-destructive">
          Computer offline. Control is suspended. Stop is unconfirmed until the computer reconnects
          or the host’s 30-second idle timeout expires.
        </p>
      )}
      {frame && (
        <div className="overflow-hidden rounded-lg border bg-black">
          <img
            ref={imageElement}
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt="Remote primary display"
            draggable={false}
            tabIndex={control ? 0 : undefined}
            className="mx-auto max-h-[65vh] max-w-full object-contain outline-offset-2"
            onKeyDown={key}
            onPointerDown={(event) => {
              if (!control || event.button !== 0) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              pointer.current = point(event)
            }}
            onPointerMove={(event) => {
              if (pointer.current || !control || Date.now() - moveAt.current < 400) return
              moveAt.current = Date.now()
              input({ type: 'move', ...point(event) })
            }}
            onPointerUp={(event) => {
              const from = pointer.current
              pointer.current = null
              if (!from || !control) return
              const to = point(event)
              if (Math.hypot(to.x - from.x, to.y - from.y) > 5) {
                if (clickTimer.current) clearTimeout(clickTimer.current)
                clickTimer.current = null
                input({ type: 'drag', ...from, toX: to.x, toY: to.y })
                return
              }
              const previous = clickPoint.current
              if (
                clickTimer.current &&
                previous &&
                Math.hypot(to.x - previous.x, to.y - previous.y) < 10
              ) {
                clearTimeout(clickTimer.current)
                clickTimer.current = null
                input({ type: 'click', ...to, button: 'left', count: 2 })
              } else {
                if (clickTimer.current) {
                  clearTimeout(clickTimer.current)
                  if (previous) input({ type: 'click', ...previous, button: 'left', count: 1 })
                }
                clickPoint.current = to
                clickTimer.current = setTimeout(() => {
                  clickTimer.current = null
                  input({ type: 'click', ...to, button: 'left', count: 1 })
                }, 250)
              }
            }}
            onPointerCancel={() => {
              pointer.current = null
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              if (frame) {
                const bounds = event.currentTarget.getBoundingClientRect()
                input({
                  type: 'click',
                  x: Math.max(
                    0,
                    Math.min(
                      frame.width - 1,
                      ((event.clientX - bounds.left) * frame.width) / bounds.width,
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      frame.height - 1,
                      ((event.clientY - bounds.top) * frame.height) / bounds.height,
                    ),
                  ),
                  button: 'right',
                  count: 1,
                })
              }
            }}
          />
        </div>
      )}
      {id && control && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || !!error || !connected}
            onClick={() => input({ type: 'key', key: 'tab' })}
          >
            Tab
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!error || !connected}
            onClick={() => input({ type: 'key', key: 'escape' })}
          >
            Escape
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!error || !connected}
            onClick={() => input({ type: 'scroll', direction: 'up', amount: 3 })}
          >
            Scroll up
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!error || !connected}
            onClick={() => input({ type: 'scroll', direction: 'down', amount: 3 })}
          >
            Scroll down
          </Button>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            Text
            <input
              aria-label="Text for remote desktop"
              className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"
              value={text}
              maxLength={4000}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <Button
            disabled={!text || busy || !!error || !connected}
            onClick={() => input({ type: 'text', text })}
          >
            Type text
          </Button>
        </div>
      )}
    </section>
  )
}
