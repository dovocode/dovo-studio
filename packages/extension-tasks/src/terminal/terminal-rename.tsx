import { useRef, useState, type ReactNode } from 'react'
import type { RuntimeProfile, TerminalInfo } from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from '@dovo/studio-ui'

export function TerminalRename({
  owner,
  session,
  onError,
  children,
}: {
  owner: { profile: RuntimeProfile; connected: boolean }
  session: TerminalInfo
  onError: (message: string) => void
  children: (open: () => void) => ReactNode
}) {
  const store = useWorkspace()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState('')
  const save = async (next: string | null) => {
    if (pendingRef.current || !owner.connected) return
    pendingRef.current = true
    setPending(true)
    setError('')
    onError('')
    try {
      await store.readRuntime(
        owner.profile,
        '/api/terminals/update',
        { id: session.id, title: next },
        responses.terminal,
        'POST',
      )
      await store.refreshRuntime(owner.profile).catch((cause: unknown) => {
        onError(`Terminal renamed, but its status could not refresh: ${String(cause)}`)
      })
      setOpen(false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <>
      {children(() => {
        setTitle(session.title)
        setError('')
        setOpen(true)
      })}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Rename terminal</DialogTitle>
          <DialogDescription>
            Choose a name, or let the shell and its programs update it automatically.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim()) void save(title.trim())
            }}
          >
            <Input
              aria-label="Terminal title"
              autoFocus
              maxLength={256}
              value={title}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending || !owner.connected}
                onClick={() => void save(null)}
              >
                Use automatic title
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !owner.connected || !title.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
