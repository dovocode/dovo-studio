import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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

type TerminalRenameProps = {
  owner?: { profile: RuntimeProfile; connected: boolean }
  session: TerminalInfo
  onError: (message: string) => void
  children: (open: () => void) => ReactNode
}

export function TerminalRename(props: TerminalRenameProps) {
  const store = useWorkspace()
  return (
    <TerminalRenameEditor
      key={JSON.stringify([props.owner?.profile.connection ?? store.connection, props.session.id])}
      {...props}
    />
  )
}

function TerminalRenameEditor({ owner, session, onError, children }: TerminalRenameProps) {
  const uiText = useInterfaceText()

  const store = useWorkspace()
  const connected = owner?.connected ?? store.connected
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const save = async (next: string | null) => {
    if (pendingRef.current || !connected) return
    pendingRef.current = true
    setPending(true)
    setError('')
    onError('')
    try {
      const profile =
        owner?.profile ??
        store.runtimes.find((entry) => entry.profile.id === store.activeRuntimeId)?.profile
      if (!profile) throw new Error('This computer is no longer saved.')
      if (owner)
        await store.readRuntime(
          owner.profile,
          '/api/terminals/update',
          { id: session.id, title: next },
          responses.terminal,
          'POST',
        )
      else
        await store.request(
          '/api/terminals/update',
          { id: session.id, title: next },
          responses.terminal,
        )
      if (!mounted.current) return
      await store.refreshRuntime(profile).catch((cause: unknown) => {
        if (mounted.current)
          onError(`Terminal renamed, but its status could not refresh: ${String(cause)}`)
      })
      if (mounted.current) setOpen(false)
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
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
                disabled={pending || !connected}
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
                {uiText('Cancel')}
              </Button>
              <Button type="submit" disabled={pending || !connected || !title.trim()}>
                {uiText('Save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
