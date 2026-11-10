import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import {
  branchesSchema,
  worktreeChoicesSchema,
  type CreateWorkspaceTerminal,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, ChoicePicker } from '@dovo/studio-ui'

type Checkout = 'main' | 'existing' | 'worktree'

/** Both terminal entry points read checkout choices from the draft's computer. */
export function useTerminalCheckout({
  owner,
  repositoryId,
  enabled = true,
}: {
  owner: RuntimeOverview | undefined
  repositoryId: string
  enabled?: boolean
}) {
  const { readRuntime } = useWorkspace()
  const target = JSON.stringify([owner?.profile.id, repositoryId])
  const [selection, setSelection] = useState({
    target,
    kind: 'main' as Checkout,
    path: '',
    branch: '',
  })
  const kind = selection.target === target ? selection.kind : 'main'
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify([target, kind])
  const [choices, setChoices] = useState<{
    key: string
    branches?: Schema.Schema.Type<typeof branchesSchema>
    worktrees?: Schema.Schema.Type<typeof worktreeChoicesSchema>
    error?: string
  }>({ key: '' })
  useEffect(() => {
    if (!enabled || !owner?.connected || !repositoryId || kind === 'main') return
    let current = true
    setChoices({ key })
    const fail = (cause: unknown) => {
      if (current)
        setChoices({ key, error: cause instanceof Error ? cause.message : String(cause) })
    }
    if (kind === 'worktree') {
      void readRuntime(owner.profile, '/api/scm/branches', { repositoryId }, branchesSchema, 'POST')
        .then((branches) => {
          if (!current) return
          setChoices({ key, branches })
          setSelection((previous) => ({
            target,
            kind,
            path: '',
            branch:
              previous.target === target &&
              previous.kind === kind &&
              branches.branches.some((branch) => branch.ref === previous.branch)
                ? previous.branch
                : (branches.branches.find(
                    (branch) => branch.name === branches.current || branch.ref === branches.current,
                  )?.ref ??
                  branches.branches[0]?.ref ??
                  ''),
          }))
        })
        .catch(fail)
    } else {
      void readRuntime(
        owner.profile,
        '/api/scm/worktrees/choices',
        { repositoryId },
        worktreeChoicesSchema,
        'POST',
      )
        .then((worktrees) => {
          if (!current) return
          setChoices({ key, worktrees })
          setSelection((previous) => ({
            target,
            kind,
            path:
              previous.target === target &&
              previous.kind === kind &&
              worktrees.worktrees.some((tree) => tree.path === previous.path)
                ? previous.path
                : (worktrees.worktrees[0]?.path ?? ''),
            branch: '',
          }))
        })
        .catch(fail)
    }
    return () => {
      current = false
    }
  }, [enabled, owner?.profile, owner?.connected, key, retry, readRuntime])
  const options = choices.key === key ? choices : undefined
  const ready =
    !repositoryId ||
    kind === 'main' ||
    (kind === 'worktree'
      ? !!options?.branches?.branches.some((branch) => branch.ref === selection.branch)
      : !!options?.worktrees?.worktrees.some((tree) => tree.path === selection.path))
  const input: Pick<
    CreateWorkspaceTerminal,
    'execution' | 'existingWorktreePath' | 'worktreeBaseBranch'
  > = repositoryId
    ? {
        execution: kind === 'main' ? 'main' : 'worktree',
        ...(kind === 'existing' ? { existingWorktreePath: selection.path } : {}),
        ...(kind === 'worktree' ? { worktreeBaseBranch: selection.branch } : {}),
      }
    : {}
  return {
    kind,
    ready,
    input,
    options,
    repositoryId,
    path: selection.path,
    branch: selection.branch,
    choose: (kind: Checkout) => setSelection({ target, kind, path: '', branch: '' }),
    choosePath: (path: string) => setSelection((previous) => ({ ...previous, path })),
    chooseBranch: (branch: string) => setSelection((previous) => ({ ...previous, branch })),
    retry: () => setRetry((value) => value + 1),
  }
}

export function TerminalCheckoutControls({
  checkout,
  disabled,
}: {
  checkout: ReturnType<typeof useTerminalCheckout>
  disabled: boolean
}) {
  if (!checkout.repositoryId) return null
  const className = 'h-7 w-auto max-w-full border-0 bg-transparent text-xs shadow-none'
  return (
    <>
      <ChoicePicker
        aria-label="Terminal checkout"
        className={className}
        value={checkout.kind}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === 'main' || value === 'existing' || value === 'worktree')
            checkout.choose(value)
        }}
      >
        <option value="main">Local checkout</option>
        <option value="existing">Existing worktree</option>
        <option value="worktree">New worktree</option>
      </ChoicePicker>
      {checkout.kind === 'worktree' && checkout.options?.branches && (
        <ChoicePicker
          aria-label="Terminal base branch"
          className={className}
          value={checkout.branch}
          disabled={disabled}
          onValueChange={checkout.chooseBranch}
        >
          {!checkout.options.branches.branches.length && (
            <option value="">No branches available</option>
          )}
          {checkout.options.branches.branches.map((branch) => (
            <option key={branch.ref} value={branch.ref}>
              {branch.name}
            </option>
          ))}
        </ChoicePicker>
      )}
      {checkout.kind === 'existing' && checkout.options?.worktrees && (
        <ChoicePicker
          aria-label="Terminal existing worktree"
          className={className}
          value={checkout.path}
          disabled={disabled}
          onValueChange={checkout.choosePath}
        >
          {!checkout.options.worktrees.worktrees.length && (
            <option value="">No existing worktrees</option>
          )}
          {checkout.options.worktrees.worktrees.map((tree) => (
            <option key={tree.path} value={tree.path}>
              {tree.branch || tree.path} · {tree.path}
              {tree.dirty ? ' · modified' : ''}
            </option>
          ))}
        </ChoicePicker>
      )}
      {!disabled &&
        checkout.kind !== 'main' &&
        !checkout.options?.branches &&
        !checkout.options?.worktrees &&
        !checkout.options?.error && (
          <span role="status" className="text-xs text-muted-foreground">
            Loading {checkout.kind === 'worktree' ? 'branches' : 'worktrees'}…
          </span>
        )}
      {!disabled && checkout.options?.error && (
        <span role="alert" className="text-xs text-destructive">
          Could not load checkout choices: {checkout.options.error}{' '}
          <Button type="button" size="sm" variant="ghost" onClick={checkout.retry}>
            Retry checkout choices
          </Button>
        </span>
      )}
    </>
  )
}
