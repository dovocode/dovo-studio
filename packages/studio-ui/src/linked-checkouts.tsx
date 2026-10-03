import { useState, useRef, useLayoutEffect } from 'react'
import { worktreeChoicesSchema, type LinkedCheckout, type Repository } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'

export function LinkedCheckoutEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly LinkedCheckout[]
  onChange: (links: LinkedCheckout[]) => void
  disabled?: boolean
}) {
  const latest = useRef({ value, onChange })
  useLayoutEffect(() => {
    latest.current = { value, onChange }
  }, [value, onChange])
  const update = (id: string, next: LinkedCheckout) => {
    const current = latest.current
    current.onChange(current.value.map((item) => (item.id === id ? next : item)))
  }
  const { workspace } = useWorkspace()
  const projects = workspace.repositories.filter((repo) => repo.kind !== 'scratch')
  return (
    <section className="space-y-3" aria-label="Linked projects">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Linked projects</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !projects.length || value.length >= 12}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                repositoryId: projects[0].id,
                execution: projects[0].kind === 'folder' ? 'main' : 'worktree',
                access: 'read-only',
              },
            ])
          }
        >
          Add checkout
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Projects on this computer. New worktrees are created when the thread runs, with separate
        branches and checkpoints.
      </p>
      {value.map((link) => (
        <LinkedCheckoutFields
          key={link.id}
          link={link}
          projects={projects}
          disabled={disabled}
          onChange={(next) => update(link.id, next)}
          onRemove={() => onChange(value.filter((item) => item.id !== link.id))}
        />
      ))}
    </section>
  )
}

function LinkedCheckoutFields({
  link,
  projects,
  disabled,
  onChange,
  onRemove,
}: {
  link: LinkedCheckout
  projects: Repository[]
  disabled: boolean
  onChange: (link: LinkedCheckout) => void
  onRemove: () => void
}) {
  const { request } = useWorkspace()
  const [worktrees, setWorktrees] = useState<Array<{ path: string; branch: string }>>([])
  const [error, setError] = useState('')
  const generation = useRef(0)
  useLayoutEffect(() => {
    generation.current++
    return () => {
      generation.current++
    }
  }, [request, link.repositoryId])
  const [busy, setBusy] = useState(false)
  const repo = projects.find((item) => item.id === link.repositoryId)
  const mode = link.existingWorktreePath ? 'existing' : link.execution
  const chooseMode = async (mode: string) => {
    onChange({
      ...link,
      execution: mode === 'main' ? 'main' : 'worktree',
      existingWorktreePath: undefined,
      branch: undefined,
      baseBranch: undefined,
    })
    setError('')
    if (mode !== 'existing') return
    const currentGeneration = ++generation.current
    setBusy(true)
    try {
      const result = await request(
        '/api/scm/worktrees/choices',
        { repositoryId: link.repositoryId },
        worktreeChoicesSchema,
      )
      if (generation.current !== currentGeneration) return
      setWorktrees(result.worktrees)
      if (!result.worktrees.length) setError('No existing worktrees. Choose New worktree instead.')
      else
        onChange({
          ...link,
          execution: 'worktree',
          existingWorktreePath: result.worktrees[0].path,
          branch: undefined,
          baseBranch: undefined,
        })
    } catch (cause) {
      if (generation.current === currentGeneration)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation.current === currentGeneration) setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="block text-xs">
        Project
        <ChoicePicker
          aria-label="Linked project"
          className="mt-1 w-full"
          value={link.repositoryId}
          disabled={disabled || busy}
          onValueChange={(repositoryId) => {
            setWorktrees([])
            setError('')
            onChange({
              id: link.id,
              repositoryId,
              access: link.access,
              execution: projects.find((item) => item.id === repositoryId)?.kind
                ? 'main'
                : 'worktree',
            })
          }}
        >
          {!repo && <option value={link.repositoryId}>Unavailable project</option>}
          {projects.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
        </ChoicePicker>
      </label>
      <label className="block text-xs">
        Checkout
        <ChoicePicker
          aria-label="Linked checkout"
          className="mt-1 w-full"
          value={mode}
          disabled={disabled || busy}
          onValueChange={(mode) => {
            void chooseMode(mode)
          }}
        >
          <option value="main">Main checkout</option>
          {!repo?.kind && (
            <>
              <option value="worktree">New worktree</option>
              <option value="existing">Existing worktree</option>
            </>
          )}
        </ChoicePicker>
      </label>
      {link.existingWorktreePath && (
        <ChoicePicker
          aria-label="Existing linked worktree"
          value={link.existingWorktreePath}
          disabled={disabled || busy}
          onValueChange={(existingWorktreePath) => onChange({ ...link, existingWorktreePath })}
        >
          {!worktrees.some((item) => item.path === link.existingWorktreePath) && (
            <option value={link.existingWorktreePath}>{link.existingWorktreePath}</option>
          )}
          {worktrees.map((item) => (
            <option key={item.path} value={item.path}>
              {item.branch || 'Detached HEAD'} · {item.path}
            </option>
          ))}
        </ChoicePicker>
      )}
      {mode === 'worktree' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            Base branch
            <Input
              aria-label="Linked base branch"
              placeholder="Project default"
              disabled={disabled}
              value={link.baseBranch ?? ''}
              onChange={(event) =>
                onChange({ ...link, baseBranch: event.target.value || undefined })
              }
            />
          </label>
          <label className="text-xs">
            Branch name
            <Input
              aria-label="Linked branch name"
              placeholder="From thread title"
              disabled={disabled}
              value={link.branch ?? ''}
              onChange={(event) => onChange({ ...link, branch: event.target.value || undefined })}
            />
          </label>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <ChoicePicker
          aria-label="Linked project access"
          value={link.access}
          disabled={disabled}
          onValueChange={(access) => {
            if (access === 'read-only' || access === 'edit') onChange({ ...link, access })
          }}
        >
          <option value="read-only">Reference only</option>
          <option value="edit">Allow edits</option>
        </ChoicePicker>
        <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={onRemove}>
          Remove link
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
