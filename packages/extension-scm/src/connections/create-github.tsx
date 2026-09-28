import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, responses } from '@dovo/studio-core'
import { repositoryGitStatusSchema } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
  ChoicePicker,
} from '@dovo/studio-ui'

export function CreateGithub({ path, disabled = false }: { path: string; disabled?: boolean }) {
  const { request, connected } = useWorkspace()
  const [available, setAvailable] = useApplicationState(false)
  const [open, setOpen] = useApplicationState(false)
  const [name, setName] = useApplicationState('')
  const [visibility, setVisibility] = useApplicationState('private')
  const [busy, setBusy] = useApplicationState(false)
  const [status, setStatus] = useApplicationState('')
  const pending = useRef(false)
  useEffect(() => {
    let alive = true
    setAvailable(false)
    setStatus('')
    if (!connected || !path.trim()) return
    const timer = setTimeout(() => {
      void request('/api/scm/repositories/git-status', { path }, repositoryGitStatusSchema)
        .then((result) => {
          if (alive) setAvailable(!result.remotes.length)
        })
        .catch((error) => {
          if (alive) setStatus(String(error))
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [request, connected, path])
  return (
    <>
      {available && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !connected}
          onClick={() => {
            setName(path.replace(/\/$/, '').split('/').at(-1) ?? '')
            setStatus('')
            setOpen(true)
          }}
        >
          Create on GitHub…
        </Button>
      )}
      {open && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!pending.current) setOpen(value)
          }}
        >
          <DialogContent>
            <DialogTitle>Create GitHub repository</DialogTitle>
            <DialogDescription>
              Uses the GitHub account signed in on the runtime computer. Initializes Git if needed
              and adds origin. Files are uploaded only when you commit and push.
            </DialogDescription>
            <p className="break-all text-xs text-muted-foreground">{path}</p>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (pending.current) return
                pending.current = true
                setBusy(true)
                setStatus('')
                void request(
                  '/api/scm/repositories/github/create',
                  { path, name: name.trim(), visibility },
                  responses.inspected,
                )
                  .then(() => {
                    setAvailable(false)
                    setOpen(false)
                    setStatus('GitHub repository created. Stage, commit and push when ready.')
                  })
                  .catch((error) =>
                    setStatus(
                      `${String(error)} Check GitHub and refresh before retrying; repository creation may have completed.`,
                    ),
                  )
                  .finally(() => {
                    pending.current = false
                    setBusy(false)
                  })
              }}
            >
              <label className="grid gap-1 text-xs">
                Repository name or owner/name
                <Input
                  required
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <ChoicePicker
                aria-label="Repository visibility"
                value={visibility}
                disabled={busy}
                onValueChange={setVisibility}
              >
                <option value="private">Private</option>
                <option value="public">Public — visible to everyone</option>
              </ChoicePicker>
              {status && (
                <p role="status" className="text-xs text-muted-foreground">
                  {status}
                </p>
              )}
              <Button type="submit" disabled={busy || !connected || !name.trim()}>
                {busy ? 'Creating…' : `Create ${visibility} repository`}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {!open && status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </>
  )
}
