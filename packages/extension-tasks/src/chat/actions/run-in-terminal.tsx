import { useMemo, useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { codeBlockLabel, fencedCodeBlocks, shellCommand } from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { Button, DropdownMenu, MessageAction } from '@dovo/studio-ui'

const item =
  'rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[highlighted]:bg-accent/55 motion-reduce:transition-none'

/** Runs a shell block from an agent reply in the task's terminal. */
export function RunInTerminal({
  taskId,
  text,
  onRan,
}: {
  taskId: string
  text: string
  onRan: (terminalId: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const commands = useMemo(
    () =>
      fencedCodeBlocks(text).flatMap((block, index) => {
        const command = shellCommand(block)
        return command ? [{ command, label: codeBlockLabel(block, index) }] : []
      }),
    [text],
  )
  if (!commands.length) return null
  const run = (command: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    void request('/api/terminals/run', { taskId, command }, responses.terminal)
      .then((terminal) => onRan(terminal.id))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const disabled = !connected || busy
  return (
    <>
      {commands.length === 1 ? (
        <MessageAction
          label={`Run in terminal: ${commands[0].command.split('\n')[0]}`}
          className="size-6 text-muted-foreground"
          disabled={disabled}
          onClick={() => run(commands[0].command)}
        >
          <SquareTerminal size={12} />
        </MessageAction>
      ) : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Run a command in the terminal"
              title="Run a command in the terminal"
              className="size-6 text-muted-foreground"
              disabled={disabled}
            >
              <SquareTerminal size={12} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={4}
              align="start"
              className="z-50 max-w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {commands.map((entry, index) => (
                <DropdownMenu.Item
                  key={index}
                  className={`${item} truncate font-mono`}
                  onSelect={() => run(entry.command)}
                >
                  {entry.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {error && (
        <span role="alert" className="text-[0.625rem] text-destructive">
          {error}
        </span>
      )}
    </>
  )
}
