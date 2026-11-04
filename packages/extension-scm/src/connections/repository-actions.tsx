import { useRepositoryOpen } from '@dovo/studio-core/repository-open'
import { RuntimeRequestError } from '@dovo/protocol'
import type { Schema } from 'effect'
import { CreateGithub } from './create-github'
import { useEffect, useEffectEvent, useId, useRef } from 'react'
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

type PushState =
  | { kind: 'ready'; value: Schema.Schema.Type<typeof responses.gitActionState> }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }

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

function stagingUnavailable(file: ChangedFile) {
  return (
    !file.gitStatus ||
    file.gitStatus.index === 'unknown' ||
    file.gitStatus.workingTree === 'unknown'
  )
}

function canStageFile(file: ChangedFile) {
  return stagingUnavailable(file) || file.gitStatus?.workingTree !== 'unchanged'
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
    [pushState, setPushState] = useApplicationState<PushState | null>(null),
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
  const messageId = useId()
  const changesHeading = useRef<HTMLHeadingElement>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const stagingKnown = files.every((file) => file.gitStatus && file.gitStatus.index !== 'unknown')
  const unstagedKnown = files.every(
    (file) => file.gitStatus && file.gitStatus.workingTree !== 'unknown',
  )
  const stagedFiles = files.filter(isStaged)
  const unstagedFiles = files.filter((file) => !stagingUnavailable(file) && canStageFile(file))
  const unknownFiles = files.filter(stagingUnavailable)
  const stagedCount = stagedFiles.length
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
  const actionState = pushState?.kind === 'ready' ? pushState.value : null
  const pushAvailable = !!actionState?.branch && actionState.canPush && !actionState.behind
  const canPush =
    connected &&
    !busy &&
    !loading &&
    !loadError &&
    pushAvailable &&
    (actionState.ahead > 0 || !actionState.tracking)
  const pushReason = !connected
    ? 'Connect to the runtime to check Push availability.'
    : loading
      ? 'Checking branch status…'
      : loadError
        ? 'Git state unavailable. Refresh Git before pushing.'
        : pushState?.kind === 'unsupported'
          ? 'Update this runtime to check Push availability. Staging and commit are still available.'
          : pushState?.kind === 'error'
            ? `Could not check Push availability: ${pushState.message}. Use Refresh Git to retry.`
            : !actionState?.branch
              ? 'Check out a branch before pushing.'
              : actionState.behind > 0
                ? `${actionState.behind} ${actionState.behind === 1 ? 'commit' : 'commits'} behind upstream. Pull or rebase before pushing.`
                : !actionState.canPush
                  ? 'No push destination available. Configure a Git remote.'
                  : !actionState.tracking
                    ? 'Publish this branch and set its upstream.'
                    : actionState.ahead > 0
                      ? `${actionState.ahead} ${actionState.ahead === 1 ? 'commit' : 'commits'} ready to push.`
                      : 'Branch is up to date.'
  const readPushState = async (): Promise<PushState> => {
    try {
      return {
        kind: 'ready',
        value: await request('/api/scm/action-state', input, responses.gitActionState),
      }
    } catch (error) {
      return error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)
        ? { kind: 'unsupported' }
        : { kind: 'error', message: String(error) }
    }
  }
  const refresh = async () => {
    if (!mounted.current) return
    const current = ++revision.current
    setLoading(true)
    setLoadError('')
    setPushState(null)
    try {
      const [inspected, result, pushResult] = await Promise.all([
        request('/api/scm/inspect', input, responses.inspected),
        request('/api/scm/changes', input, responses.files),
        readPushState(),
      ])
      if (!mounted.current || current !== revision.current) return
      setCheckout(inspected.path)
      setBranch(inspected.branch)
      setFiles(result.files)
      setPushState(pushResult)
      setSelected((previous) =>
        previous.filter((path) =>
          result.files.some((file) => file.path === path && canStageFile(file)),
        ),
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
  useEffect(() => {
    if (loading || loadError || !connected || files.length) return
    const active = document.activeElement
    if (active === document.body || active?.getAttribute('role') === 'dialog')
      changesHeading.current?.focus()
  }, [loading, loadError, connected, files.length])
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
          <h3 ref={changesHeading} tabIndex={-1} className="text-xs font-medium">
            Changes
          </h3>
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
          <div className="space-y-3">
            <section aria-label="Staged" className="overflow-hidden rounded-lg border">
              <h4 className="border-b bg-muted/30 px-3 py-2 text-xs font-medium">
                Staged · {stagedCount}
                {!stagingKnown && ' known'}
              </h4>
              {stagedFiles.length ? (
                <ul className="max-h-40 overflow-auto py-1">
                  {stagedFiles.map((file) => (
                    <li key={file.path} className="flex items-start gap-3 px-3 py-1.5 text-xs">
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-[0.6875rem]">
                          {file.path}
                        </span>
                        <span className="mt-0.5 block text-muted-foreground">
                          Staged: {changeLabels[file.gitStatus?.index ?? 'unknown']}
                        </span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Unstage ${file.path}`}
                        disabled={busy || loading || !connected || !!loadError}
                        onClick={() =>
                          act(async () => {
                            await request(
                              '/api/scm/unstage',
                              { ...input, paths: [file.path] },
                              responses.ok,
                            )
                            setStatus(`Unstaged ${file.path}. Working file contents kept.`)
                            await refresh()
                          })
                        }
                      >
                        Unstage
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {stagingKnown ? 'No staged files.' : 'Staged membership is not fully available.'}
                </p>
              )}
            </section>
            {[
              { name: 'Unstaged', files: unstagedFiles, unavailable: false },
              { name: 'Staging status unavailable', files: unknownFiles, unavailable: true },
            ].map(
              (group) =>
                (group.files.length > 0 || !group.unavailable) && (
                  <section
                    key={group.name}
                    aria-label={group.name}
                    className="overflow-hidden rounded-lg border"
                  >
                    <div className="border-b bg-muted/30 px-3 py-2">
                      <label className="flex items-center gap-2 text-xs font-medium">
                        <Checkbox
                          aria-label={
                            group.unavailable
                              ? 'Select all files with unavailable staging status'
                              : 'Select all unstaged files'
                          }
                          checked={
                            group.files.length > 0 &&
                            group.files.every((file) => selected.includes(file.path))
                              ? true
                              : group.files.some((file) => selected.includes(file.path))
                                ? 'indeterminate'
                                : false
                          }
                          disabled={busy || !group.files.length}
                          onCheckedChange={(checked) =>
                            setSelected((previous) =>
                              checked === true
                                ? [
                                    ...new Set([
                                      ...previous,
                                      ...group.files.map((file) => file.path),
                                    ]),
                                  ]
                                : previous.filter(
                                    (path) => !group.files.some((file) => file.path === path),
                                  ),
                            )
                          }
                        />
                        {group.name} · {group.files.length}
                      </label>
                    </div>
                    {group.unavailable && (
                      <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                        These files may already be staged. Update this runtime to see their
                        membership.
                      </p>
                    )}
                    {group.files.length ? (
                      <ul className="max-h-40 overflow-auto py-1">
                        {group.files.map((file) => (
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
                                  {group.unavailable || file.gitStatus?.workingTree === 'unmerged'
                                    ? fileStagingDescription(file)
                                    : file.gitStatus?.workingTree === 'untracked'
                                      ? 'Untracked'
                                      : `Unstaged: ${changeLabels[file.gitStatus?.workingTree ?? 'unknown']}`}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No unstaged files.</p>
                    )}
                  </section>
                ),
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {selected.length} {selected.length === 1 ? 'file' : 'files'} selected
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  loading ||
                  !connected ||
                  !!loadError ||
                  !selected.length ||
                  selected.length > 200
                }
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
            {selected.length > 200 && (
              <p className="text-xs text-muted-foreground">
                Select up to 200 files to stage at a time.
              </p>
            )}
          </div>
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            No uncommitted changes.
          </p>
        )}
        {files.length > 0 && (
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
            <label htmlFor={messageId} className="block text-xs font-medium">
              Commit message
            </label>
            <Input
              id={messageId}
              placeholder="Commit message for staged changes"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!connected || busy || loading || !!loadError}
              required
            />
            <p className="text-xs text-muted-foreground">
              Commits include all staged changes. Selection only controls staging.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!canCommit}>
                Commit staged
              </Button>
              <Button
                type="button"
                size="sm"
                aria-describedby={`${messageId}-push`}
                disabled={!canCommit || !pushAvailable}
                onClick={() => {
                  if (!canCommit || !pushAvailable) return
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
                }}
              >
                Commit &amp; push
              </Button>
            </div>
          </form>
        )}
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
            aria-label="Push branch"
            aria-describedby={`${messageId}-push`}
            disabled={!canPush}
            onClick={() => {
              if (!canPush) return
              act(async () => {
                await request('/api/scm/push', input, responses.ok)
                setStatus('Branch pushed.')
                await refresh()
              })
            }}
          >
            Push branch{actionState && actionState.ahead > 0 ? ` (${actionState.ahead})` : ''}
          </Button>
        </div>
        <p
          id={`${messageId}-push`}
          aria-label="Push status"
          className="text-xs text-muted-foreground"
        >
          {pushReason}
        </p>
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
