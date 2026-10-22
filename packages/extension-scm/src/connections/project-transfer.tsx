import { useEffect, useRef, useState } from 'react'
import { Schema } from 'effect'
import { CopyPlus, ChevronDown } from 'lucide-react'
import {
  randomUUID,
  parseSshAddress,
  decodeResult,
  validationMessages,
  projectTransferStartSchema,
  projectTransferSchema,
  projectTransferInspectionSchema,
  projectTransferTargetsSchema,
  projectTransferPlanSchema,
  projectTransferPlanInputSchema,
  worktreeChoicesSchema,
  worktreeListSchema,
  type Task,
  projectTransferActive,
  projectTransferLabel,
  projectTransferPeers,
  type ProjectTransfer,
  type Repository,
} from '@dovo/protocol'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
import { Button, Input, FormField, Dialog, DialogContent, DialogTitle } from '@dovo/studio-ui'

export function ProjectTransferSettings({
  repository,
  sourceTask,
  initiallyOpen = false,
}: {
  repository: Repository
  sourceTask?: Task
  initiallyOpen?: boolean
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(initiallyOpen),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [inspection, setInspection] = useState<typeof projectTransferInspectionSchema.Type | null>(
    null,
  )
  const [worktreePath, setWorktreePath] = useState('')
  const [worktrees, setWorktrees] = useState<typeof worktreeChoicesSchema.Type.worktrees>([])
  const [createThread, setCreateThread] = useState(!!sourceTask)
  const [prompt, setPrompt] = useState('')
  const [targets, setTargets] = useState<typeof projectTransferTargetsSchema.Type>([])
  const [targetId, setTargetId] = useState(''),
    [transport, setTransport] = useState('p2p')
  const [ignored, setIgnored] = useState<string[]>([])
  const [sshHost, setSshHost] = useState(''),
    [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('22'),
    [runtimePort, setRuntimePort] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const [destinationPlan, setDestinationPlan] = useState<{
    key: string
    value: typeof projectTransferPlanSchema.Type
  } | null>(null)
  const [destinationError, setDestinationError] = useState<{ key: string; message: string } | null>(
    null,
  )
  const [destinationRepositoryId, setDestinationRepositoryId] = useState('')
  const [parentDirectory, setParentDirectory] = useState('')
  const [planRevision, setPlanRevision] = useState(0)
  const [localJob, setLocalJob] = useState<ProjectTransfer | null>(null)
  const latest = store.snapshot?.projectTransfers
    ?.filter((job) => job.repositoryId === repository.id)
    .at(-1)
  const job = (latest?.updatedAt ?? 0) >= (localJob?.updatedAt ?? 0) ? latest : localJob
  const active = !!job && projectTransferActive(job)
  const pending = useRef(false),
    refreshed = useRef('')
  const act = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const choose = (id: string) => {
    setTargetId(id)
    const target = store.runtimes.find(
      (entry) => (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === id,
    )
    setIdentityFile('')
    setSshHost('')
    setSshUser('')
    setSshPort('22')
    setRuntimePort('')
    if (target) {
      const url = new URL(target.profile.connection.address)
      setSshHost(url.hostname)
      if (target.snapshot?.sshAddress) {
        const ssh = parseSshAddress(target.snapshot.sshAddress)
        setSshHost(ssh.sshHost)
        setSshUser(ssh.sshUser)
        setSshPort(String(ssh.sshPort))
      }
      setRuntimePort(url.protocol === 'https:' ? '5235' : url.port || '80')
    }
  }
  const sourceResolved = useRef(false)
  const initialLoad = useRef(initiallyOpen)
  const load = (sourcePath = worktreePath) =>
    act(async () => {
      setInspection(null)
      setPlanRevision((value) => value + 1)
      if (sourceTask && !sourceResolved.current) {
        if (!store.snapshot?.projectWorktreeTransfersSupported)
          throw new Error('Update this computer to copy worktrees to another computer.')
        if (sourceTask.existingWorktreePath) sourcePath = sourceTask.existingWorktreePath
        else if (sourceTask.execution === 'worktree' && sourceTask.checkoutBranch) {
          const list = await store.request('/api/scm/worktrees/read', {}, worktreeListSchema)
          const source = list.worktrees.find(
            (item) =>
              item.repositoryId === repository.id &&
              !item.prunable &&
              item.branch === sourceTask.checkoutBranch &&
              (item.taskId === sourceTask.id || item.threadIds.includes(sourceTask.id)),
          )
          if (!source) throw new Error('This thread’s worktree is no longer available.')
          sourcePath = source.path
        }
        setWorktreePath(sourcePath)
        sourceResolved.current = true
      }
      const peers = projectTransferPeers(
        store.runtimeRegistry.profiles,
        store.runtimes,
        store.snapshot?.runtimeId,
      )
      await store.request(
        '/api/retrieval/peers',
        { sessionId: 'project-transfer', peers },
        Schema.Struct({ ok: Schema.Boolean }),
      )
      const [, files, choices] = await Promise.all([
        store
          .request('/api/scm/project-transfer/targets', {}, projectTransferTargetsSchema)
          .then((machines) => {
            setTargets(machines)
            if (!machines.some((machine) => machine.id === targetId)) choose(machines[0]?.id ?? '')
          }),
        store.request(
          '/api/scm/project-transfer/inspect',
          { repositoryId: repository.id, worktreePath: sourcePath || undefined },
          projectTransferInspectionSchema,
        ),
        !repository.kind && store.snapshot?.projectWorktreeTransfersSupported
          ? store.request(
              '/api/scm/worktrees/choices',
              { repositoryId: repository.id },
              worktreeChoicesSchema,
            )
          : Promise.resolve({ worktrees: [] }),
      ])
      setWorktrees(choices.worktrees)
      setInspection(files)
      setIgnored((previous) =>
        previous.filter((path) => files.ignoredFiles.some((file) => file.path === path)),
      )
    })
  useEffect(() => {
    if (!initialLoad.current) return
    initialLoad.current = false
    void load()
  })
  useEffect(() => {
    if (job?.state !== 'completed' || refreshed.current === job.id) return
    const target = store.runtimes.find(
      (entry) => (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === job.targetId,
    )
    if (target) {
      refreshed.current = job.id
      void store
        .refreshRuntime(target.profile)
        .catch((error) => setError(error instanceof Error ? error.message : String(error)))
    }
  }, [job, store.runtimes, store.refreshRuntime])
  const planInput = {
    repositoryId: repository.id,
    worktreePath: worktreePath || undefined,
    targetId,
    ssh:
      transport === 'ssh'
        ? {
            sshHost,
            sshUser,
            sshPort: Number(sshPort),
            runtimePort: Number(runtimePort),
            identityFile: identityFile || undefined,
          }
        : undefined,
  }
  const planKey = JSON.stringify(planInput)
  const plan = destinationPlan?.key === planKey ? destinationPlan.value : null
  const planError = destinationError?.key === planKey ? destinationError.message : ''
  const destination = plan?.repositories.length
    ? {
        repositoryId:
          destinationRepositoryId ||
          (plan.repositories.length === 1 ? plan.repositories[0]!.id : ''),
      }
    : { parentDirectory: parentDirectory.trim() }
  const destinationReady =
    !worktreePath ||
    (!!plan &&
      ('repositoryId' in destination ? !!destination.repositoryId : !!destination.parentDirectory))
  useEffect(() => {
    if (!open || !worktreePath || !targetId || active) return
    let cancelled = false
    setDestinationError(null)
    setDestinationPlan(null)
    setDestinationRepositoryId('')
    setParentDirectory('')
    const input = decodeResult(projectTransferPlanInputSchema, JSON.parse(planKey))
    if (!input.success) {
      setDestinationError({
        key: planKey,
        message: 'Complete the connection settings to check the destination project.',
      })
      return
    }
    const timer = setTimeout(
      () => {
        void store
          .request('/api/scm/project-transfer/plan', input.data, projectTransferPlanSchema)
          .then(
            (value) => {
              if (!cancelled) setDestinationPlan({ key: planKey, value })
            },
            (error: unknown) => {
              if (!cancelled)
                setDestinationError({
                  key: planKey,
                  message: error instanceof Error ? error.message : String(error),
                })
            },
          )
      },
      transport === 'ssh' ? 500 : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, worktreePath, targetId, planKey, active, planRevision])
  if (repository.kind === 'scratch') return null
  if (!store.snapshot?.projectTransfersSupported)
    return (
      <p className="text-xs text-muted-foreground">
        Update this computer to copy projects to another computer.
      </p>
    )
  const start = (retry = false) =>
    act(async () => {
      if (retry && job) {
        setLocalJob(
          await store.request(
            '/api/scm/project-transfer/retry',
            { id: job.id },
            projectTransferSchema,
          ),
        )
        return
      }
      if (!destinationReady)
        throw new Error('Choose the destination project or its parent folder before copying.')
      const parsed = decodeResult(projectTransferStartSchema, {
        id: randomUUID(),
        repositoryId: repository.id,
        worktreePath: worktreePath || undefined,
        destination: worktreePath ? destination : undefined,
        thread: createThread
          ? {
              title:
                prompt.trim().slice(0, 200) ||
                `${repository.name} on ${targets.find((target) => target.id === targetId)?.name ?? 'another computer'}`.slice(
                  0,
                  200,
                ),
              prompt,
            }
          : undefined,
        targetId,
        ignoredFiles: ignored,
        ...(transport === 'ssh'
          ? {
              ssh: {
                sshHost,
                sshUser,
                sshPort: Number(sshPort),
                runtimePort: Number(runtimePort),
                identityFile: identityFile || undefined,
              },
            }
          : {}),
      })
      if (!parsed.success)
        throw new Error(
          validationMessages(parsed.error)[0] ?? 'Check the destination and SSH settings.',
        )
      const input = parsed.data
      setLocalJob(
        await store.request('/api/scm/project-transfer/start', input, projectTransferSchema),
      )
    })
  return (
    <section
      className="space-y-3 rounded-lg border p-3"
      aria-label="Copy project to another computer"
    >
      <div className="flex items-center gap-2">
        <CopyPlus className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Add to another computer</p>
          <p className="text-xs text-muted-foreground">
            Copy files and local Git history. Chats stay here.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-label="Configure project copy"
          onClick={() => {
            setOpen(!open)
            if (!open) void load()
          }}
        >
          <ChevronDown className={`size-4 ${open ? 'rotate-180' : ''}`} />
        </Button>
      </div>
      {job && (
        <div role="status" className="space-y-1 text-xs">
          <p className={job.state === 'failed' ? 'text-destructive' : ''}>
            {projectTransferLabel(job)}
          </p>
          {active && (
            <progress
              className="h-1.5 w-full"
              aria-label="Project copy progress"
              value={job.state === 'preparing' ? undefined : job.bytes}
              max={job.totalBytes || 1}
            />
          )}
          {job.targetTaskId && (
            <>
              <p>Thread created on {job.targetName}.</p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const target = store.runtimes.find(
                      (entry) =>
                        (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) ===
                        job.targetId,
                    )
                    if (!target)
                      throw new Error('Pair the destination computer to open this thread')
                    await store.switchRuntime(target.profile.id)
                    host.navigate({ viewId: 'tasks', entityId: job.targetTaskId })
                  })
                }
              >
                Open thread on {job.targetName}
              </Button>
            </>
          )}
          {job.threadStartError && (
            <p role="alert" className="text-destructive">
              Files copied and thread saved. Could not start agent: {job.threadStartError}
            </p>
          )}
          {job.path && <p className="break-all text-muted-foreground">{job.path}</p>}
          {!!job.skippedLinks && (
            <p className="text-muted-foreground">{job.skippedLinks} symbolic links skipped.</p>
          )}
          {active && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await store.request(
                    '/api/scm/project-transfer/cancel',
                    { id: job.id },
                    Schema.Struct({ ok: Schema.Boolean }),
                  )
                })
              }
            >
              Cancel copy
            </Button>
          )}
        </div>
      )}
      {open && (
        <div className="space-y-3">
          <fieldset
            disabled={busy || active || !store.connected}
            className="space-y-3 disabled:opacity-60"
          >
            {!!worktrees.length && (
              <FormField label="Source checkout">
                <select
                  aria-label="Source checkout"
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  value={worktreePath}
                  onChange={(event) => {
                    const path = event.target.value
                    setWorktreePath(path)
                    setIgnored([])
                    setLocalJob(null)
                    void load(path)
                  }}
                >
                  <option value="">Project checkout</option>
                  {worktrees.map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.branch || 'Detached HEAD'}
                      {entry.dirty ? ' · Local changes' : ''} · {entry.path}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {!!store.snapshot?.projectWorktreeTransfersSupported && (
              <div className="space-y-2 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createThread}
                    onChange={(event) => setCreateThread(event.target.checked)}
                  />
                  Create a thread on destination
                </label>
                {createThread && (
                  <>
                    <FormField label="First message (optional)">
                      <Input value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                    </FormField>
                    <p className="text-muted-foreground">
                      Leave empty for a draft. A message starts the agent using the destination’s
                      settings in the copied checkout.
                    </p>
                  </>
                )}
              </div>
            )}
            <FormField label="Destination computer">
              <select
                aria-label="Destination computer"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={targetId}
                onChange={(event) => choose(event.target.value)}
              >
                <option value="">Choose a paired computer</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </select>
            </FormField>
            {!!worktreePath && (
              <div className="space-y-2 text-xs">
                {!plan && !planError && (
                  <p className="text-muted-foreground">Checking destination project…</p>
                )}
                {!!planError && (
                  <p role="alert" className="text-destructive">
                    {planError}
                  </p>
                )}
                {plan &&
                  (plan.repositories.length ? (
                    <FormField label="Destination project">
                      <select
                        aria-label="Destination project"
                        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                        value={
                          'repositoryId' in destination ? (destination.repositoryId ?? '') : ''
                        }
                        onChange={(event) => setDestinationRepositoryId(event.target.value)}
                      >
                        <option value="">Choose an existing project</option>
                        {plan.repositories.map((repo) => (
                          <option key={repo.id} value={repo.id}>
                            {repo.name} · {repo.path}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        This project is not on the destination yet. Where should its main checkout
                        go?
                      </p>
                      <FormField label="Project parent folder on destination">
                        <Input
                          value={parentDirectory}
                          onChange={(event) => setParentDirectory(event.target.value)}
                          placeholder="/Users/you/Projects"
                        />
                      </FormField>
                    </>
                  ))}
                {plan && (
                  <p className="break-all text-muted-foreground">
                    Copied worktree directory: {plan.worktreesRoot}. The main checkout stays
                    separate.
                  </p>
                )}
                {!!planError && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPlanRevision((value) => value + 1)}
                  >
                    Check destination project
                  </Button>
                )}
              </div>
            )}
            {!targets.length && (
              <p className="text-xs text-muted-foreground">
                Pair another computer in Settings → Computers, then refresh.
              </p>
            )}
            <FormField label="Connection">
              <select
                aria-label="Project copy connection"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={transport}
                onChange={(event) => setTransport(event.target.value)}
              >
                <option value="p2p">Dovo P2P</option>
                <option value="ssh">SSH tunnel</option>
              </select>
            </FormField>
            {transport === 'ssh' && (
              <div className="space-y-2 rounded-md bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">
                  Connect from this computer to the destination’s Dovo runtime using a trusted SSH
                  key.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="SSH host">
                    <Input
                      value={sshHost}
                      onChange={(event) => setSshHost(event.target.value)}
                      placeholder="computer.local"
                    />
                  </FormField>
                  <FormField label="SSH user">
                    <Input value={sshUser} onChange={(event) => setSshUser(event.target.value)} />
                  </FormField>
                  <FormField label="SSH port">
                    <Input
                      inputMode="numeric"
                      value={sshPort}
                      onChange={(event) => setSshPort(event.target.value)}
                    />
                  </FormField>
                  <FormField label="Dovo HTTP port on destination">
                    <Input
                      inputMode="numeric"
                      value={runtimePort}
                      onChange={(event) => setRuntimePort(event.target.value)}
                    />
                  </FormField>
                </div>
                <FormField label="SSH key on this computer (optional)">
                  <Input
                    value={identityFile}
                    onChange={(event) => setIdentityFile(event.target.value)}
                    placeholder="Use configured SSH keys"
                  />
                </FormField>
              </div>
            )}
            {inspection && (
              <div className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  {inspection.files} files · {(inspection.bytes / 1048576).toFixed(1)} MB, plus Git
                  history.{' '}
                  {worktreePath
                    ? 'Linked worktree on the destination.'
                    : 'New folder under ~/.dovo/projects on the destination.'}
                </p>
                {!!inspection.skippedLinks && (
                  <p className="text-muted-foreground">
                    {inspection.skippedLinks} symbolic links will be skipped.
                  </p>
                )}
                {inspection.ignoredFilesTruncated && (
                  <p className="text-muted-foreground">
                    Only the first 10,000 ignored or private files are listed. Unselected files stay
                    on this computer.
                  </p>
                )}
                {!!inspection.ignoredFiles.length && (
                  <details>
                    <summary className="cursor-pointer">
                      Include ignored or private files ({ignored.length} selected)
                    </summary>
                    <p className="my-2 text-muted-foreground">
                      Only select configuration and secrets you want on the destination. Generated
                      folders are excluded.
                    </p>
                    <div className="max-h-40 space-y-1 overflow-auto">
                      {inspection.ignoredFiles.map((file) => (
                        <label key={file.path} className="flex items-start gap-2 break-all">
                          <input
                            type="checkbox"
                            checked={ignored.includes(file.path)}
                            onChange={(event) =>
                              setIgnored((current) =>
                                event.target.checked
                                  ? [...current, file.path]
                                  : current.filter((path) => path !== file.path),
                              )
                            }
                          />
                          {file.path}
                        </label>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </fieldset>
          {!active && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !inspection || !targetId || !store.connected || !destinationReady}
                onClick={() => void start()}
              >
                {busy
                  ? 'Preparing…'
                  : createThread
                    ? 'Copy and create thread'
                    : worktreePath
                      ? 'Copy worktree'
                      : 'Copy project'}
              </Button>
              {job?.state === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !store.connected}
                  onClick={() => void start(true)}
                >
                  Retry copy
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !store.connected}
                onClick={() => void load()}
              >
                Refresh
              </Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

/** Reuse the project copy flow from machine pickers and thread menus. */
export function ProjectTransferDialog({
  repository,
  sourceTask,
  onClose,
}: {
  repository: Repository
  sourceTask?: Task
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>
          {sourceTask
            ? sourceTask.execution === 'worktree'
              ? 'Copy worktree to another machine'
              : 'Copy project checkout to another machine'
            : 'Add to another machine'}
        </DialogTitle>
        <ProjectTransferSettings repository={repository} sourceTask={sourceTask} initiallyOpen />
      </DialogContent>
    </Dialog>
  )
}
