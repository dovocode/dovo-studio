import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { integrationMutationError } from '../../connections/mutation-error'
import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  pullTaskResponse,
  useStudioHost,
  useWorkspace,
  useRuntimeSources,
  type PullDetail,
} from '@dovo/studio-core'
import { pullReviewRepositories, resolvePullReviewSource } from '@dovo/studio-core/pull-code-review'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { Check, ChevronDown, Plus } from 'lucide-react'

export function StartPullTask({
  repositoryId,
  initialObjective,
  stackAction,
  pull,
  open,
  onOpenChange,
}: {
  repositoryId: string
  initialObjective?: string
  stackAction?: 'update'
  pull: PullDetail['pull']
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const uiText = useInterfaceText()

  const { request, connected, activeRuntimeId, runtimeRegistry, switchRuntime, readRuntime } =
    useWorkspace()
  const computers = useRuntimeSources()
  const [chosenComputer, setChosenComputer] = useApplicationState('')
  const [chosenProject, setChosenProject] = useApplicationState('')
  const runtimeId = chosenComputer || activeRuntimeId || ''
  const remote = runtimeId !== activeRuntimeId
  const computer = computers.find((computer) => computer.profile.id === runtimeId)
  const projects = remote
    ? pullReviewRepositories(pull.url, computer?.snapshot?.workspace.repositories ?? [])
    : []
  const projectId = projects.some((project) => project.id === chosenProject)
    ? chosenProject
    : projects.length === 1
      ? projects[0].id
      : ''
  const canCreate = remote ? !!computer?.connected && !!projectId : connected
  const host = useStudioHost()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [created, setCreated] = useApplicationState<{ id: string; runtimeId: string } | undefined>(
    undefined,
  )
  const mounted = useRef(true)
  const pending = useRef(false)
  const baseline = useRef(pull)
  const previousOpen = useRef(open)
  if (open && !previousOpen.current) baseline.current = pull
  previousOpen.current = open
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const openTask = async (
    id: string,
    targetRuntimeId: string,
    current = host.taskNavigationGuard?.() ?? (() => true),
  ) => {
    if (!mounted.current || !current()) return
    if (targetRuntimeId && targetRuntimeId !== runtimeRegistry.activeId)
      await switchRuntime(targetRuntimeId)
    if (mounted.current && current()) host.navigate({ viewId: 'tasks', entityId: id })
  }
  const create = async (checkoutMode: 'new-branch' | 'pr-branch') => {
    if (pending.current || !canCreate) return
    pending.current = true
    const current = host.taskNavigationGuard?.() ?? (() => true)
    setBusy(true)
    setError('')
    try {
      const targetRequest: typeof request =
        remote && computer
          ? (path, input, schema, method) =>
              readRuntime(computer.profile, path, input, schema, method)
          : request
      const source = remote
        ? await resolvePullReviewSource({
            detail: { pull: baseline.current },
            repositoryId: projectId,
            request: targetRequest,
            remember: () => {},
          })
        : undefined
      const sourcePull = source?.pull ?? baseline.current
      const result = await targetRequest(
        '/api/scm/pulls/task',
        {
          repositoryId: remote ? projectId : repositoryId,
          number: sourcePull.number,
          headSha: sourcePull.headSha,
          expectedDestination: source?.destination ?? sourcePull.destination,
          connectionId: sourcePull.connectionId,
          objective: stackAction
            ? 'Update the stack, restack branches and update PRs.'
            : (initialObjective ?? 'I want to work on this PR.'),
          checkoutMode,
          stackAction,
          run: false,
        },
        pullTaskResponse,
      )
      if (!mounted.current) return
      setCreated({ id: result.id, runtimeId })
      await openTask(result.id, runtimeId, current)
    } catch (cause) {
      if (mounted.current) setError(integrationMutationError(cause))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const itemClass =
    'cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40'
  return (
    <div className="relative">
      <DropdownMenu.Root
        open={open}
        onOpenChange={(value) => {
          if (value) baseline.current = pull
          onOpenChange?.(value)
        }}
      >
        <DropdownMenu.Trigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="@max-sm/pr-detail:hidden"
            aria-label={uiText('New thread')}
            title="Start a thread from this PR"
            disabled={(!connected && !computers.some((computer) => computer.connected)) || busy}
          >
            <Plus className="size-3.5" />
            <span className="hidden @lg/pr-detail:inline">{busy ? 'Creating…' : 'New thread'}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            aria-label="PR worktree branch"
            className="z-50 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            {computers.length > 1 && (
              <>
                <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
                  {uiText('Computer')}
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={runtimeId}
                  onValueChange={(id) => {
                    setChosenComputer(id)
                    setChosenProject('')
                  }}
                >
                  {computers.map((computer) => (
                    <DropdownMenu.RadioItem
                      key={computer.profile.id}
                      value={computer.profile.id}
                      className={`${itemClass} flex items-center justify-between gap-3`}
                      disabled={!computer.connected || busy}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {computer.name}
                      {computer.connected ? '' : ` · ${uiText('Offline')}`}
                      {runtimeId === computer.profile.id && <Check className="size-3.5" />}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              </>
            )}
            {remote && projects.length > 1 && (
              <DropdownMenu.RadioGroup
                value={projectId}
                onValueChange={setChosenProject}
                aria-label={uiText('Project')}
              >
                {projects.map((project) => (
                  <DropdownMenu.RadioItem
                    key={project.id}
                    value={project.id}
                    className={`${itemClass} flex items-center justify-between gap-3`}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {project.name} · {project.path}
                    {projectId === project.id && <Check className="size-3.5" />}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            )}
            {remote && !projects.length && (
              <p role="status" className="max-w-72 px-3 py-2 text-xs text-muted-foreground">
                {uiText('Open this repository as a project on this computer first.')}
              </p>
            )}
            <DropdownMenu.Item
              className={itemClass}
              disabled={!canCreate || busy}
              onSelect={() => void create('new-branch')}
            >
              {stackAction ? 'Update PR stack' : 'New branch from PR'}
            </DropdownMenu.Item>
            {!stackAction && (
              <DropdownMenu.Item
                className={itemClass}
                disabled={!pull.headCloneUrl || !canCreate || busy}
                onSelect={() => void create('pr-branch')}
                title={!pull.headCloneUrl ? 'The PR source repository is unavailable.' : undefined}
              >
                Use PR branch
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {created && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void openTask(created.id, created.runtimeId).catch((cause: unknown) => {
              if (mounted.current) setError(integrationMutationError(cause))
            })
          }
        >
          Open created thread
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border bg-popover p-3 text-xs text-destructive shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  )
}
