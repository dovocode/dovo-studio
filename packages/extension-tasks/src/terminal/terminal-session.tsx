import { startReconnecting, startSocketHeartbeat } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { responses, useWorkspace } from '@dovo/studio-core'
export function TerminalSession({ id, active }: { id: string; active: boolean }) {
  const { connection, request } = useWorkspace(),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useApplicationState('')
  useEffect(() => {
    if (!container.current || !connection) return
    let socket: WebSocket | undefined
    const terminal = new Terminal({
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: {
          background: '#0d0e10',
          foreground: '#d4d4d8',
        },
        scrollback: 5000,
      }),
      fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    const resize = () => {
      if (container.current?.clientWidth && container.current.clientHeight) {
        fit.fit()
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              type: 'resize',
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          )
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: 'input',
            data,
          }),
        )
    })
    const reconnect = startReconnecting(
      async (signal, connected) => {
        const { ticket } = await request('/api/terminals/ticket', { id }, responses.ticket)
        if (signal.aborted) return
        const url = new URL('/ws/terminal', connection.address)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('ticket', ticket)
        await new Promise<void>((resolve, reject) => {
          const current = new WebSocket(url)
          current.binaryType = 'arraybuffer'
          let heartbeat: ReturnType<typeof startSocketHeartbeat> | undefined
          socket = current
          const cleanup = () => {
            heartbeat?.stop()
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            current.onopen = current.onmessage = current.onerror = current.onclose = null
            current.close()
            if (socket === current) socket = undefined
          }
          const abort = () => {
            cleanup()
            resolve()
          }
          const fail = (message: string) => {
            cleanup()
            reject(new Error(message))
          }
          const timeout = setTimeout(
            () => fail('Terminal connection timed out. Reconnecting…'),
            10000,
          )
          signal.addEventListener('abort', abort, { once: true })
          current.onopen = () => {
            clearTimeout(timeout)
            connected()
            terminal.reset()
            setError('')
            resize()
            heartbeat = startSocketHeartbeat(
              (message) => current.send(message),
              () => fail('Terminal stopped responding. Reconnecting…'),
            )
          }
          current.onmessage = (event) => {
            if (typeof event.data === 'string') terminal.write(event.data)
            else heartbeat?.receive(event.data)
          }
          current.onerror = () => fail('Terminal connection failed. Reconnecting…')
          current.onclose = () => fail('Terminal disconnected. Reconnecting…')
        })
      },
      (error) => setError(error.message),
    )
    const wake = () => {
      if (document.visibilityState === 'visible') reconnect.restart()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      void reconnect.stop()
      input.dispose()
      observer.disconnect()
      terminal.dispose()
    }
  }, [id, connection, request])
  return (
    <div className={active ? 'relative min-h-0 flex-1' : 'hidden'}>
      <div ref={container} className="h-full p-2" />
      {error && (
        <p role="alert" className="absolute bottom-0 bg-card p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
