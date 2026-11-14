import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { terminalFileLinks, type TerminalFileLink } from './terminal-file-links'
import { createRuntimeClient } from '@dovo/protocol'
import { startReconnecting, useAppPreferences, fontStack, systemMonoFont } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BrowserTerminal,
  openElectronTerminalPort,
  terminalDropPaths,
  type BrowserTerminalOptions,
} from '@dovo/terminal'
import { terminalFontSources } from '@dovo/studio-ui/terminal-fonts'
import { responses, useWorkspace, useStudioTheme, useResolvedTheme } from '@dovo/studio-core'
import { terminalSelection } from './terminal-selection'
import { ContextMenu } from '@dovo/studio-ui'
import { copyTextToClipboard, readTextFromClipboard } from '@dovo/studio-ui/clipboard'

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
  const uiText = useInterfaceText()

  const { connection, request, connected } = useWorkspace(),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useApplicationState('')
  const [selectionError, setSelectionError] = useApplicationState('')
  const [hasSelection, setHasSelection] = useApplicationState(false)
  const [writable, setWritable] = useApplicationState(false)
  const [actionError, setActionError] = useApplicationState('')
  const fileHandler = useRef(onOpenFile)
  fileHandler.current = onOpenFile
  const actionScope = useRef(0)
  const canWriteRef = useRef<(() => boolean) | null>(null)
  const inputAllowedRef = useRef(false)
  inputAllowedRef.current = active && connected && !readOnly
  const menuContext = useRef<{
    terminal: BrowserTerminal
    scope: number
    selection: string
  } | null>(null)
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
      background: colors.background,
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
  const terminalOptions = useMemo<BrowserTerminalOptions>(
    () => ({
      fontFamily: fontStack(terminalFontFamily, systemMonoFont),
      fontSize: terminalFontSize,
      theme: terminalTheme,
      scrollbackBytes: 16 * 1024 * 1024,
      fonts: terminalFontFamily === 'JetBrains Mono Nerd Font' ? terminalFontSources : [],
    }),
    [terminalFontFamily, terminalFontSize, terminalTheme],
  )
  const optionsRef = useRef(terminalOptions)
  optionsRef.current = terminalOptions
  const terminalRef = useRef<BrowserTerminal | null>(null)
  useEffect(() => {
    if (!container.current || !connection) return
    let writable = false
    setWritable(false)
    setHasSelection(false)
    canWriteRef.current = () => writable
    const terminal = new BrowserTerminal(optionsRef.current)
    terminalRef.current = terminal
    terminal.onError = (cause) => setError(cause.message)
    terminal.onCopy = copyTextToClipboard
    // Browser paste events retain OS permissions. Electron uses its trusted clipboard bridge.
    if (window.dovoReadText)
      terminal.onPaste = async () => {
        const scope = actionScope.current
        const text = await readTextFromClipboard()
        if (scope !== actionScope.current || !canWriteRef.current?.() || !inputAllowedRef.current)
          return
        terminal.paste(text)
        terminal.focus()
      }
    terminal.onDrop = (data) => {
      const scope = actionScope.current
      setActionError('')
      void (async () => {
        if (!canWriteRef.current?.() || !inputAllowedRef.current)
          throw new Error('Terminal is not writable.')
        // Resolve the native files while the drop event still owns its data.
        const paths = terminalDropPaths(data)
        if (!paths.length) return
        const result = await request(
          '/api/terminals/quote-paths',
          { id, paths },
          responses.terminalPaths,
        )
        if (scope !== actionScope.current || !canWriteRef.current?.() || !inputAllowedRef.current)
          return
        terminal.paste(result.text)
        terminal.focus()
      })().catch((cause: unknown) => {
        if (scope === actionScope.current)
          setActionError(
            `Could not insert file paths: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
      })
    }
    terminal.onActivate = (point, viewport) => {
      const handler = fileHandler.current
      if (!handler) return
      let first = point.y,
        last = point.y
      while (first > 0 && viewport.lines[first - 1]?.wrapped && point.y - first < 16) first--
      while (viewport.lines[last]?.wrapped && last - first < 16 && last < viewport.lines.length - 1)
        last++
      let text = '',
        offset = 0
      for (let row = first; row <= last; row++) {
        const line = viewport.lines[row]
        if (!line) continue
        if (row === point.y) {
          offset = text.length
          let column = 0
          for (let index = 0; index < line.text.length; index++) {
            if (column > point.x) break
            offset = text.length + index
            column += line.widths[index] ?? 0
          }
        }
        text += line.text
      }
      const file = terminalFileLinks(text).find((file) => offset >= file.start && offset < file.end)
      if (!file) return
      const scope = actionScope.current
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
    }
    terminal.open(container.current)
    const selection = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection())
      setSelectionError('')
    })
    const reconnect = startReconnecting(
      async (signal, connected) => {
        const ticket = await request('/api/terminals/ticket', { id }, responses.ticket)
        if (signal.aborted) return
        const url = new URL(createRuntimeClient(connection).socketUrl('/ws/terminal', ticket))
        url.searchParams.set('stream', 'binary-v1')
        const port = await openElectronTerminalPort(url.href, signal)
        try {
          await terminal.connect(
            url.href,
            signal,
            () => {
              connected()
              writable = true
              setWritable(true)
              setError('')
            },
            port,
          )
        } finally {
          writable = false
          setWritable(false)
          actionScope.current++
        }
      },
      (cause) => setError(cause.message),
    )
    const wake = () => {
      if (document.visibilityState === 'visible' && !writable) reconnect.restart()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      void reconnect.stop()
      selection.dispose()
      terminal.dispose()
      terminalRef.current = null
      canWriteRef.current = null
    }
  }, [id, connection, request])
  useEffect(() => {
    terminalRef.current?.configure(terminalOptions)
  }, [terminalOptions])
  useEffect(() => {
    terminalRef.current?.setInputEnabled(active && connected && !readOnly)
  }, [active, connected, readOnly, id, connection, request])
  useEffect(() => {
    terminalRef.current?.setVisible(active)
  }, [active])
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
      if (operation === 'copy') await copyTextToClipboard(context.selection)
      else {
        const text = await readTextFromClipboard()
        if (currentMenu() !== context) return
        if (!canWriteRef.current?.() || !inputAllowedRef.current)
          throw new Error('Terminal is not writable.')
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
          <div ref={container} className="h-full p-3" />
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
          {(actionError || error) && (
            <p role="alert" className="absolute bottom-0 bg-card p-2 text-xs text-destructive">
              {actionError || error}
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
            {uiText('Copy')}
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
