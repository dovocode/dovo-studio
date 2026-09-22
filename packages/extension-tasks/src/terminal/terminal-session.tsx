import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { responses, useWorkspace } from '@dovo/studio-core'
export function TerminalSession({ id, active }: { id: string; active: boolean }) {
  const { connection, request } = useWorkspace(),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useState('')
  useEffect(() => {
    if (!container.current || !connection) return
    let disposed = false,
      socket: WebSocket | undefined
    const terminal = new Terminal({
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0d0e10', foreground: '#d4d4d8' },
        scrollback: 5000,
      }),
      fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    const resize = () => {
      if (container.current?.clientWidth && container.current.clientHeight) {
        fit.fit()
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'input', data }))
    })
    void request('/api/terminals/ticket', { id }, responses.ticket)
      .then(({ ticket }) => {
        if (disposed) return
        const url = new URL('/ws/terminal', connection.address)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('ticket', ticket)
        socket = new WebSocket(url)
        socket.onopen = resize
        socket.onmessage = (event) => {
          if (typeof event.data === 'string') terminal.write(event.data)
        }
        socket.onerror = () =>
          setError('Terminal connection failed. Close and reopen this session to reconnect.')
        socket.onclose = (event) => {
          if (!disposed) setError(event.reason || 'Terminal disconnected')
        }
      })
      .catch((error) => {
        if (!disposed) setError(String(error))
      })
    return () => {
      disposed = true
      socket?.close()
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
