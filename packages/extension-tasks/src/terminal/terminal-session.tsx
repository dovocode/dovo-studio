import { terminalFileLinks, type TerminalFileLink } from './terminal-file-links'
import { createRuntimeClient } from '@dovo/protocol'
import { terminalInputFrames } from '@dovo/studio-core'
import {
  startReconnecting,
  startSocketHeartbeat,
  useAppPreferences,
  fontStack,
  systemMonoFont,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { responses, useWorkspace, useStudioTheme, useResolvedTheme } from '@dovo/studio-core'
import { terminalSelection } from './terminal-selection'
import { ContextMenu } from '@dovo/studio-ui'

const menuItem =
  'cursor-default rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50'
export function TerminalSession({
  id,
  active,
  onAddSelection,
  onOpenFile,
  focusRequest = 0,
  readOnly = false,
}: {
  id: string
  active: boolean
  onAddSelection?: (text: string) => void
  onOpenFile?: (file: TerminalFileLink) => Promise<void>
  focusRequest?: number
  readOnly?: boolean
}) {
  const { connection, request, connected } = useWorkspace(),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useApplicationState(''),
    [fontError, setFontError] = useApplicationState('')
  const [selectionError, setSelectionError] = useApplicationState('')
  const [hasSelection, setHasSelection] = useApplicationState(false)
  const [writable, setWritable] = useApplicationState(false)
  const [actionError, setActionError] = useApplicationState('')
  const fileHandler = useRef(onOpenFile)
  fileHandler.current = onOpenFile
  const actionScope = useRef(0)
  const canWriteRef = useRef<(() => boolean) | null>(null)
  const menuContext = useRef<{ terminal: Terminal; scope: number; selection: string } | null>(null)
  useLayoutEffect(() => {
    actionScope.current++
    setActionError('')
    return () => {
      actionScope.current++
    }
  }, [id, connection, request, active, connected, readOnly])
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
    setWritable(false)
    setHasSelection(false)
    canWriteRef.current = () => socket?.readyState === WebSocket.OPEN
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
    const links = terminal.registerLinkProvider({
      provideLinks(y, callback) {
        if (!fileHandler.current) {
          callback(undefined)
          return
        }
        const buffer = terminal.buffer.active
        let first = y - 1,
          last = first
        while (first > 0 && buffer.getLine(first)?.isWrapped) {
          if (y - first > 16) {
            callback(undefined)
            return
          }
          first--
        }
        while (buffer.getLine(last + 1)?.isWrapped) {
          if (last - first >= 16) {
            callback(undefined)
            return
          }
          last++
        }
        let text = ''
        const cells: { x: number; y: number; end: number }[] = []
        for (let row = first; row <= last; row++) {
          const line = buffer.getLine(row)
          if (!line) continue
          for (let x = 0; x < line.length; x++) {
            const cell = line.getCell(x)
            if (!cell || !cell.getWidth()) continue
            const chars = cell.getChars() || ' '
            for (let index = 0; index < chars.length; index++)
              cells.push({ x: x + 1, y: row + 1, end: x + cell.getWidth() })
            text += chars
          }
          if (text.length > 65536) {
            callback(undefined)
            return
          }
        }
        callback(
          terminalFileLinks(text).flatMap((file) => {
            const start = cells[file.start],
              end = cells[file.end - 1]
            if (!start || !end || y < start.y || y > end.y) return []
            return [
              {
                text: text.slice(file.start, file.end),
                range: { start: { x: start.x, y: start.y }, end: { x: end.end, y: end.y } },
                activate() {
                  const handler = fileHandler.current,
                    scope = actionScope.current
                  if (!handler) return
                  setActionError('')
                  void handler({
                    path: file.path,
                    line: file.line,
                    ...(file.column ? { column: file.column } : {}),
                  }).catch((cause: unknown) => {
                    if (scope === actionScope.current)
                      setActionError(
                        `Could not open terminal file (relative paths use the terminal’s starting directory): ${cause instanceof Error ? cause.message : String(cause)}`,
                      )
                  })
                },
              },
            ]
          }),
        )
      },
    })
    const selection = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection())
      setSelectionError('')
    })
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
        const ticket = await request('/api/terminals/ticket', { id }, responses.ticket)
        if (signal.aborted) return
        const url = createRuntimeClient(connection).socketUrl('/ws/terminal', ticket)
        await new Promise<void>((resolve, reject) => {
          const current = new WebSocket(url)
          current.binaryType = 'arraybuffer'
          let heartbeat: ReturnType<typeof startSocketHeartbeat> | undefined
          socket = current
          const cleanup = () => {
            actionScope.current++
            heartbeat?.stop()
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            current.onopen = current.onmessage = current.onerror = current.onclose = null
            current.close()
            if (socket === current) socket = undefined
            setWritable(false)
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
            setWritable(true)
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
      links.dispose()
      input.dispose()
      observer.disconnect()
      selection.dispose()
      terminal.dispose()
      terminalRef.current = null
      resizeRef.current = null
      canWriteRef.current = null
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
  useEffect(() => {
    if (active && focusRequest) terminalRef.current?.focus()
  }, [active, focusRequest])
  const currentMenu = () => {
    const context = menuContext.current
    return context &&
      context.scope === actionScope.current &&
      context.terminal === terminalRef.current
      ? context
      : null
  }
  const addSelection = (text: string) => {
    try {
      const selection = terminalSelection(text)
      if (selection) onAddSelection?.(selection)
    } catch (cause) {
      setSelectionError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const clipboard = async (operation: 'copy' | 'paste') => {
    const context = currentMenu()
    if (!context) return
    setActionError('')
    try {
      if (operation === 'copy') await navigator.clipboard.writeText(context.selection)
      else {
        const text = await navigator.clipboard.readText()
        if (currentMenu() !== context) return
        if (!canWriteRef.current?.()) throw new Error('Terminal is not connected.')
        context.terminal.paste(text)
      }
      if (currentMenu() === context) context.terminal.focus()
    } catch (cause) {
      if (currentMenu() === context)
        setActionError(
          `Could not ${operation} terminal text: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
    }
  }
  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open && terminalRef.current)
          menuContext.current = {
            terminal: terminalRef.current,
            scope: actionScope.current,
            selection: terminalRef.current.getSelection(),
          }
      }}
    >
      <ContextMenu.Trigger asChild>
        <div className={active ? 'relative min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}>
          <div ref={container} className="h-full p-2" />
          {onAddSelection && hasSelection && (
            <button
              type="button"
              className="absolute right-2 top-2 rounded border bg-card px-2 py-1 text-xs"
              onClick={() => addSelection(terminalRef.current?.getSelection() ?? '')}
            >
              Add selection to message
            </button>
          )}
          {selectionError && (
            <p role="alert" className="absolute bottom-0 bg-card p-2 text-xs text-destructive">
              {selectionError}
            </p>
          )}
          {(actionError || error || fontError) && (
            <p role="alert" className="absolute bottom-0 bg-card p-2 text-xs text-destructive">
              {actionError || error || fontError}
            </p>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
          <ContextMenu.Item
            className={menuItem}
            disabled={!hasSelection}
            onSelect={() => void clipboard('copy')}
          >
            Copy
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            disabled={!active || !connected || !writable || readOnly}
            onSelect={() => void clipboard('paste')}
          >
            Paste
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => {
              const terminal = currentMenu()?.terminal
              terminal?.selectAll()
              terminal?.focus()
            }}
          >
            Select all
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => {
              const terminal = currentMenu()?.terminal
              terminal?.scrollToBottom()
              terminal?.focus()
            }}
          >
            Jump to latest
          </ContextMenu.Item>
          {onAddSelection && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className={menuItem}
                disabled={!hasSelection}
                onSelect={() => {
                  const context = currentMenu()
                  if (context) addSelection(context.selection)
                }}
              >
                Add selection to message
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
