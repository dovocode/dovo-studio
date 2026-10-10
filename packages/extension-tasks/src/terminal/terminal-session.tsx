import { terminalInputFrames } from '@dovo/studio-core'
import {
  startReconnecting,
  startSocketHeartbeat,
  useAppPreferences,
  fontStack,
  systemMonoFont,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { responses, useWorkspace, useStudioTheme, useResolvedTheme } from '@dovo/studio-core'
export function TerminalSession({ id, active }: { id: string; active: boolean }) {
  const { connection, request } = useWorkspace(),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useApplicationState(''),
    [fontError, setFontError] = useApplicationState('')
  const { terminalFontFamily, terminalFontSize } = useAppPreferences()
  const colors = useStudioTheme()
  const mode = useResolvedTheme()
  const terminalTheme = useMemo(
    () => ({
      background: colors.card,
      foreground: colors.foreground,
      cursor: colors.primary,
      cursorAccent: colors.background,
      selectionBackground: colors.selection,
      black: colors.background,
      brightBlack: colors['muted-foreground'],
      red: mode === 'dark' ? '#ff7e97' : '#ba2549',
      brightRed: mode === 'dark' ? '#ff7e97' : '#ba2549',
      green: mode === 'dark' ? '#4deb8c' : '#14753c',
      brightGreen: mode === 'dark' ? '#4deb8c' : '#14753c',
      yellow: mode === 'dark' ? '#ffd36a' : '#956100',
      brightYellow: mode === 'dark' ? '#ffd36a' : '#956100',
      blue: colors.primary,
      brightBlue: colors.primary,
      magenta: colors.pink,
      brightMagenta: colors.pink,
      cyan: colors.signal,
      brightCyan: colors.signal,
      white: colors.foreground,
      brightWhite: colors.foreground,
    }),
    [colors, mode],
  )
  const themeRef = useRef(terminalTheme)
  themeRef.current = terminalTheme
  const resizeRef = useRef<(() => void) | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  useEffect(() => {
    if (!container.current || !connection) return
    let socket: WebSocket | undefined
    const terminal = new Terminal({
        fontSize: 12,
        fontFamily: systemMonoFont,
        theme: themeRef.current,
        scrollback: 5000,
      }),
      fit = new FitAddon()
    terminal.loadAddon(fit)
    terminalRef.current = terminal
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
    resizeRef.current = resize
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN)
        for (const frame of terminalInputFrames(data)) socket.send(JSON.stringify(frame))
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
    // Only replace a socket that is not open; the heartbeat already detects dead ones, and a
    // restart resets the screen and loses the cursor and scroll position.
    const wake = () => {
      if (document.visibilityState === 'visible' && socket?.readyState !== WebSocket.OPEN)
        reconnect.restart()
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
      terminalRef.current = null
      resizeRef.current = null
    }
  }, [id, connection, request])
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme
  }, [terminalTheme])
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    let cancelled = false
    const family = fontStack(terminalFontFamily, systemMonoFont)
    // Measure cells only once the font is available, including bold prompt/icon text.
    void Promise.all([
      document.fonts.load(`400 ${terminalFontSize}px ${family}`),
      document.fonts.load(`700 ${terminalFontSize}px ${family}`),
    ])
      .then(() => {
        if (cancelled) return
        setFontError('')
        terminal.options.fontFamily = family
        terminal.options.fontSize = terminalFontSize
        resizeRef.current?.()
        terminal.refresh(0, terminal.rows - 1)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFontError(`Could not load terminal font: ${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [terminalFontFamily, terminalFontSize, id, connection, request, active, setFontError])
  return (
    <div className={active ? 'relative min-h-0 flex-1' : 'hidden'}>
      <div ref={container} className="h-full p-2" />
      {(error || fontError) && (
        <p role="alert" className="absolute bottom-0 bg-card p-2 text-xs text-destructive">
          {error || fontError}
        </p>
      )}
    </div>
  )
}
