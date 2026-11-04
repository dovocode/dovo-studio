import { useRepositoryOpen } from '@dovo/studio-core/repository-open'
import { CreateGithub } from './create-github'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { branchesSchema, clientScopeKey, encodeWorkTarget } from '@dovo/studio-core'
import { BranchPicker } from '@dovo/studio-ui'
import {
  responses,
  useWorkspace,
  useStudioHost,
  type Repository,
  type ChangedFile,
} from '@dovo/studio-core'
import { Button, Checkbox, Input, DropdownMenu, RepositoryOpenItems } from '@dovo/studio-ui'

const changeLabels = {
  unchanged: 'Unchanged',
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  'type-changed': 'Type changed',
  renamed: 'Renamed',
  copied: 'Copied',
  unmerged: 'Conflict',
  untracked: 'Untracked',
  unknown: 'Unknown',
} satisfies Record<NonNullable<ChangedFile['gitStatus']>['index'], string>

function isStaged(file: ChangedFile) {
  const index = file.gitStatus?.index
  return (
    file.gitStatus?.workingTree !== 'unmerged' &&
    index !== undefined &&
    !['unchanged', 'unknown', 'unmerged', 'untracked'].includes(index)
  )
}

function fileStagingDescription(file: ChangedFile) {
  const status = file.gitStatus
  if (!status) return 'Staging status unavailable'
  if (status.index === 'unmerged' || status.workingTree === 'unmerged')
    return 'Conflict: resolve before committing'
  return [
    status.index === 'unknown'
      ? 'Index status unavailable'
      : isStaged(file)
        ? `Staged: ${changeLabels[status.index]}`
        : '',
    status.workingTree === 'unknown'
      ? 'Working tree status unavailable'
      : status.workingTree === 'untracked'
        ? 'Untracked'
        : status.workingTree !== 'unchanged'
          ? `Unstaged: ${changeLabels[status.workingTree]}`
          : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function RepositoryActions(props: { repo: Repository; taskId?: string }) {
  const { connection } = useWorkspace()
  return (
    <CheckoutActions
      key={`${clientScopeKey(connection)}:${props.repo.id}:${props.taskId ?? ''}`}
      {...props}
    />
  )
}

function CheckoutActions({ repo, taskId }: { repo: Repository; taskId?: string }) {
  const openRepository = useRepositoryOpen()
  const host = useStudioHost()
  const { request, connected } = useWorkspace(),
    [checkout, setCheckout] = useApplicationState(''),
    [branch, setBranch] = useApplicationState(taskId ? '' : repo.branch),
    [files, setFiles] = useApplicationState<ChangedFile[]>([]),
    [selected, setSelected] = useApplicationState<string[]>([]),
    [loading, setLoading] = useApplicationState(true),
    [loadError, setLoadError] = useApplicationState(''),
    [message, setMessage] = useApplicationState(''),
    [status, setStatus] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const input = {
    repositoryId: repo.id,
    ...(taskId
      ? {
          taskId,
        }
      : {}),
  }
  const pending = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const stagingKnown = files.every((file) => file.gitStatus && file.gitStatus.index !== 'unknown')
  const unstagedKnown = files.every(
    (file) => file.gitStatus && file.gitStatus.workingTree !== 'unknown',
  )
  const stagedCount = files.filter(isStaged).length
  const unstagedCount = files.filter(
    (file) =>
      file.gitStatus && !['unchanged', 'unknown', 'unmerged'].includes(file.gitStatus.workingTree),
  ).length
  const hasConflicts = files.some(
    (file) => file.gitStatus?.index === 'unmerged' || file.gitStatus?.workingTree === 'unmerged',
  )
  const canCommit =
    connected &&
    !busy &&
    !loading &&
    !loadError &&
    !!message.trim() &&
    !hasConflicts &&
    (!stagingKnown || stagedCount > 0)
  const refresh = async () => {
    if (!mounted.current) return
    const current = ++revision.current
    setLoading(true)
    setLoadError('')
    try {
      const [inspected, result] = await Promise.all([
        request('/api/scm/inspect', input, responses.inspected),
        request('/api/scm/changes', input, responses.files),
      ])
      if (!mounted.current || current !== revision.current) return
      setCheckout(inspected.path)
      setBranch(inspected.branch)
      setFiles(result.files)
      setSelected((previous) =>
        previous.filter((path) => result.files.some((file) => file.path === path)),
      )
    } catch (error) {
      if (mounted.current && current === revision.current) setLoadError(String(error))
    } finally {
      if (mounted.current && current === revision.current) setLoading(false)
    }
  }
  const loadOnConnect = useEffectEvent(() => void refresh())
  useEffect(() => {
    mounted.current = true
    if (connected) loadOnConnect()
    else setLoading(false)
    return () => {
      mounted.current = false
      revision.current++
    }
  }, [connected])
  const act = (fn: () => Promise<void>) => {
    if (pending.current || !connected) return
    pending.current = true
    setBusy(true)
    setStatus('')
    void fn()
      .catch((error) => {
        if (mounted.current) setStatus(String(error))
      })
      .finally(() => {
        pending.current = false
        if (mounted.current) setBusy(false)
      })
  }
  return (
    <div className="mt-1 divide-y">
      <section className="space-y-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium">Changes</h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={!connected || busy || loading}
            onClick={() => act(refresh)}
          >
            Refresh Git
          </Button>
        </div>
        {!connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            Connect to the runtime to load changes and use Git actions.
          </p>
        ) : loading ? (
          <p role="status" className="text-xs text-muted-foreground">
            Loading changes…
          </p>
        ) : loadError ? (
          <p role="alert" className="text-xs text-destructive">
            Could not load changes: {loadError}. Use Refresh Git to retry.
          </p>
        ) : files.length ? (
          <div className="overflow-hidden rounded-lg border">
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              Select files to stage. For partially staged files, this stages their remaining
              changes.
            </p>
            <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  aria-label="Select all changed files"
                  checked={
                    selected.length === files.length
                      ? true
                      : selected.length
                        ? 'indeterminate'
                        : false
                  }
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    setSelected(checked === true ? files.map((file) => file.path) : [])
                  }
                />
                {files.length} changed {files.length === 1 ? 'file' : 'files'}
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !selected.length || selected.length > 200}
                onClick={() =>
                  act(async () => {
                    await request('/api/scm/stage', { ...input, paths: selected }, responses.ok)
                    setStatus(
                      `${selected.length} ${selected.length === 1 ? 'file' : 'files'} staged.`,
                    )
                    setSelected([])
                    await refresh()
                  })
                }
              >
                Stage selected
              </Button>
            </div>
            <ul className="max-h-52 overflow-auto py-1">
              {files.map((file) => (
                <li key={file.path}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-xs hover:bg-muted/30">
                    <Checkbox
                      aria-label={`Select ${file.path}`}
                      className="mt-0.5 shrink-0"
                      checked={selected.includes(file.path)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setSelected((previous) =>
                          checked === true
                            ? [...previous, file.path]
                            : previous.filter((path) => path !== file.path),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all font-mono text-[0.6875rem]">
                        {file.path}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {fileStagingDescription(file)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {selected.length > 200 && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                Select up to 200 files to stage at a time.
              </p>
            )}
          </div>
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            No uncommitted changes.
          </p>
        )}
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canCommit) return
            act(async () => {
              const result = await request(
                '/api/scm/commit',
                {
                  ...input,
                  message,
                },
                responses.commit,
              )
              setStatus(`Committed ${result.commit.slice(0, 8)}`)
              setMessage('')
              await refresh()
            })
          }}
        >
          {!loading && !loadError && connected && (
            <p className="text-xs text-muted-foreground" aria-label="Staging summary">
              {stagingKnown
                ? `${stagedCount} staged ${stagedCount === 1 ? 'file' : 'files'} · ${unstagedKnown ? `${unstagedCount} with unstaged changes` : 'working tree status unavailable'}`
                : 'Staged contents unavailable. Update this runtime to see commit membership.'}
              {hasConflicts && ' Resolve conflicts before committing.'}
            </p>
          )}
          <Input
            aria-label="Commit message"
            placeholder="Commit message for staged changes"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={!connected || busy}
            required
          />
          <p className="text-xs text-muted-foreground">
            Commits include all staged files, including files staged outside this dialog. Checkbox
            selection only controls Stage selected.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!canCommit}>
              Commit staged
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canCommit}
              onClick={() =>
                act(async () => {
                  const result = await request(
                    '/api/scm/commit',
                    { ...input, message },
                    responses.commit,
                  )
                  setMessage('')
                  try {
                    await request('/api/scm/push', input, responses.ok)
                    setStatus(`Committed ${result.commit.slice(0, 8)} and pushed.`)
                  } catch (error) {
                    setStatus(
                      `Committed ${result.commit.slice(0, 8)}, but push failed: ${String(error)}. Use Push branch to retry without committing again.`,
                    )
                  }
                  await refresh()
                })
              }
            >
              Commit &amp; push
            </Button>
          </div>
        </form>
      </section>
      <section className="space-y-2 py-4">
        <h3 className="text-xs font-medium">Branch</h3>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[min(100%,16rem)] flex-1">
            <BranchPicker
              current={branch || undefined}
              disabled={!connected || busy || loading}
              load={() => request('/api/scm/branches', input, branchesSchema)}
              change={async (value) => {
                if (pending.current || !connected) throw new Error('Git actions are unavailable.')
                pending.current = true
                setBusy(true)
                setStatus('')
                try {
                  const result = await request(
                    '/api/scm/branch',
                    { ...input, ...value },
                    branchesSchema,
                  )
                  setBranch(result.current)
                  setSelected([])
                  await refresh()
                  return result
                } finally {
                  pending.current = false
                  if (mounted.current) setBusy(false)
                }
              }}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || busy}
            onClick={() =>
              act(async () => {
                await request('/api/scm/push', input, responses.ok)
                setStatus('Branch pushed.')
              })
            }
          >
            Push branch
          </Button>
        </div>
        {checkout && (
          <p className="break-all font-mono text-[0.6875rem] text-muted-foreground">{checkout}</p>
        )}
      </section>
      <section className="space-y-2 pt-4">
        <h3 className="text-xs font-medium">Project</h3>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button size="sm" variant="outline" disabled={!connected || busy}>
                Open…
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={4}
                className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <RepositoryOpenItems
                  itemClass="flex items-center gap-2 rounded px-2 py-1.5 text-xs outline-none focus:bg-accent"
                  disabled={busy}
                  onSelect={(target) =>
                    act(async () => {
                      await openRepository(input, target)
                      setStatus('Opened on your computer.')
                    })
                  }
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || busy}
            onClick={() =>
              host.navigate({
                viewId: 'pulls',
                entityId: repo.id,
              })
            }
          >
            Pull requests
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              host.navigate({
                viewId: 'issues',
                entityId: encodeWorkTarget({
                  repositoryId: repo.id,
                }),
              })
            }
          >
            Issues
          </Button>
        </div>
        <CreateGithub path={repo.path} disabled={busy} />
      </section>
      {status && (
        <p role="status" className="pt-3 text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}
