import { useAppPreferences, whitespaceOnlyFile } from '@dovo/studio-core'
import { LinkedReview } from './linked-review'
import { ChoicePicker } from '@dovo/studio-ui'
import { SavedFilePreview } from '../files/saved-file-preview'
import { randomUUID, checkpointFiles } from '@dovo/protocol'
import { fileStats } from '../files/presentation'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useMemo } from 'react'
import { useLiveRefresh } from '../detail/live-refresh'
import { DiskActions } from './disk-actions'
import {
  FileDiff,
  Check,
  ChevronDown,
  ChevronRight,
  FolderTree,
  PanelRightClose,
  RefreshCw,
  SearchCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { REVIEW_PROMPT, pendingReviewComments, reviewFindings } from '@dovo/protocol'
import { ReviewFindings } from '../chat/thread/review-findings'
import { CommitBar } from './commit-bar'
import { useWorkspace, responses, updateTask, type ChangedFile, type Task } from '@dovo/studio-core'
import { Button, DropdownMenu, EmptyState, IconButton, ErrorBoundary } from '@dovo/studio-ui'
import { FileTree } from './file-tree'
import { PierreEditor } from './pierre-editor'
import { ReviewFeedback } from './review-feedback'
import { ReviewCommentsTray } from '../chat/thread/review-comments-tray'
type DiffSource = { kind: 'working' | 'branch' | 'latest' } | { kind: 'turn'; id: string }
function PrimaryReviewPane({
  task,
  onClose,
  onReference,
  onEditingChange,
}: {
  task: Task
  onEditingChange?: (editing: boolean) => void
  onClose?: () => void
  onReference?: (text: string) => void
}) {
  const { hideWhitespaceChanges } = useAppPreferences()
  const { setWorkspace, request, connected } = useWorkspace()
  const [editing, setEditing] = useApplicationState(false)
  const editingChanged = useCallback(
    (value: boolean) => {
      setEditing(value)
      onEditingChange?.(value)
    },
    [onEditingChange],
  )
  const [reviewBusy, setReviewBusy] = useApplicationState(false)
  const [reviewError, setReviewError] = useApplicationState('')
  const [actionsOpen, setActionsOpen] = useApplicationState(
    () => reviewFindings(task).length > 0 || pendingReviewComments(task).length > 0,
  )
  const [filesOpen, setFilesOpen] = useApplicationState(
    () => typeof window === 'undefined' || window.innerWidth >= 700,
  )
  const [refreshBusy, setRefreshBusy] = useApplicationState(false)
  const [source, setSource] = useApplicationState<DiffSource>({ kind: 'working' })
  const [branchRefresh, setBranchRefresh] = useApplicationState(0)
  const [branchDiff, setBranchDiff] = useApplicationState<{
    files: ChangedFile[]
    omitted: string[]
    base: string
  } | null>(null)
  const [branchLoading, setBranchLoading] = useApplicationState(false)
  const [selected, setSelected] = useApplicationState('')
  const turns = task.turns ?? []
  const selectedTurn =
    source.kind === 'latest'
      ? turns.at(-1)
      : source.kind === 'turn'
        ? turns.find((turn) => turn.id === source.id)
        : undefined
  const sourceFiles =
    source.kind === 'working'
      ? task.files
      : source.kind === 'branch'
        ? (branchDiff?.files ?? [])
        : (selectedTurn?.checkpoint?.files ?? [])
  const files = useMemo(
    () =>
      checkpointFiles({
        files: sourceFiles,
        omitted:
          source.kind === 'branch'
            ? (branchDiff?.omitted ?? [])
            : (selectedTurn?.checkpoint?.omitted ?? []),
      }).filter((file) => !hideWhitespaceChanges || !whitespaceOnlyFile(file)),
    [
      hideWhitespaceChanges,
      sourceFiles,
      source.kind,
      branchDiff?.omitted,
      selectedTurn?.checkpoint?.omitted,
    ],
  )
  const file = files.find((item) => item.path === selected) ?? files[0]
  const sourceLabel =
    source.kind === 'working'
      ? 'Working tree'
      : source.kind === 'branch'
        ? 'Branch changes'
        : source.kind === 'latest'
          ? 'Latest turn'
          : `Turn ${turns.findIndex((turn) => turn.id === (source.kind === 'turn' ? source.id : '')) + 1}`
  const refreshBranch = useCallback(async () => {
    try {
      const result = await request(
        '/api/scm/branch-changes',
        { repositoryId: task.repositoryId, taskId: task.id },
        responses.branchDiff,
      )
      setBranchDiff(result)
    } finally {
      setBranchLoading(false)
    }
  }, [request, task.repositoryId, task.id, branchRefresh])
  const branchError = useLiveRefresh(connected && source.kind === 'branch', refreshBranch)
  const chooseSource = (next: DiffSource) => {
    setSelected('')
    if (next.kind === 'branch') {
      setBranchRefresh((value) => value + 1)
      setBranchDiff(null)
      setBranchLoading(true)
    }
    setSource(next)
  }
  const stats = useMemo(() => files.map(fileStats), [files])
  const additions = stats.reduce((total, item) => total + item.additions, 0)
  const deletions = stats.reduce((total, item) => total + item.deletions, 0)
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label="Diff"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-md bg-muted/50 px-2.5 text-xs font-medium"
              aria-label={`Diff source: ${sourceLabel}`}
            >
              {sourceLabel} <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className="z-50 min-w-52 rounded-lg border bg-popover p-1.5 text-xs text-popover-foreground shadow-xl"
            >
              <DropdownMenu.Item
                className="flex cursor-default items-center rounded px-2 py-2 outline-none focus:bg-accent"
                onSelect={() => chooseSource({ kind: 'working' })}
              >
                Working tree {source.kind === 'working' && <Check className="ml-auto size-3.5" />}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-default items-center rounded px-2 py-2 outline-none focus:bg-accent data-[disabled]:opacity-50"
                disabled={!connected}
                title="Committed changes since the default branch"
                onSelect={() => chooseSource({ kind: 'branch' })}
              >
                Branch changes {source.kind === 'branch' && <Check className="ml-auto size-3.5" />}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-default items-center rounded px-2 py-2 outline-none focus:bg-accent data-[disabled]:opacity-50"
                disabled={!turns.length}
                onSelect={() => chooseSource({ kind: 'latest' })}
              >
                Latest turn {source.kind === 'latest' && <Check className="ml-auto size-3.5" />}
              </DropdownMenu.Item>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                  className="flex cursor-default items-center rounded px-2 py-2 outline-none focus:bg-accent data-[disabled]:opacity-50"
                  disabled={!turns.length}
                >
                  Turn <ChevronRight className="ml-auto size-3.5" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={4}
                    className="z-50 max-h-72 min-w-40 overflow-y-auto rounded-lg border bg-popover p-1.5 text-xs text-popover-foreground shadow-xl"
                  >
                    {[...turns].reverse().map((turn) => (
                      <DropdownMenu.Item
                        key={turn.id}
                        className="flex cursor-default items-center gap-3 rounded px-2 py-2 outline-none focus:bg-accent"
                        onSelect={() => chooseSource({ kind: 'turn', id: turn.id })}
                      >
                        Turn {turns.indexOf(turn) + 1}
                        <span className="ml-auto text-muted-foreground">
                          {new Date(turn.finishedAt ?? turn.startedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {source.kind === 'turn' && source.id === turn.id && (
                          <Check className="size-3.5" />
                        )}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="hidden text-[0.6875rem] tabular-nums sm:inline">
          <span className="text-emerald-400">+{additions}</span>{' '}
          <span className="text-rose-400">−{deletions}</span>
        </span>
        <IconButton
          label="Reload disk changes"
          className="ml-auto size-7"
          disabled={
            !connected ||
            editing ||
            refreshBusy ||
            (source.kind !== 'working' && source.kind !== 'branch')
          }
          onClick={() => {
            if (source.kind === 'branch') {
              setBranchRefresh((value) => value + 1)
              return
            }
            setRefreshBusy(true)
            void request(
              '/api/scm/changes',
              { repositoryId: task.repositoryId, taskId: task.id },
              responses.files,
            )
              .catch((cause: unknown) =>
                setReviewError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setRefreshBusy(false))
          }}
        >
          <RefreshCw size={14} className={refreshBusy ? 'animate-spin' : undefined} />
        </IconButton>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          title="The agent reviews its uncommitted changes and lists findings here"
          disabled={
            source.kind !== 'working' ||
            !connected ||
            task.status === 'running' ||
            !task.files.length ||
            reviewBusy
          }
          onClick={() => {
            setReviewBusy(true)
            setReviewError('')
            setActionsOpen(true)
            void request(
              '/api/tasks/message',
              { id: task.id, messageId: randomUUID(), text: REVIEW_PROMPT, review: true },
              responses.ok,
            )
              .catch((cause: unknown) =>
                setReviewError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setReviewBusy(false))
          }}
        >
          <SearchCheck className="size-3.5" />
          <span className="hidden sm:inline">Review changes</span>
        </Button>
        <IconButton
          label={actionsOpen ? 'Hide diff actions' : 'Show diff actions'}
          className="size-7"
          aria-pressed={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <SlidersHorizontal size={14} />
        </IconButton>
        <IconButton
          label={filesOpen ? 'Hide changed files' : 'Show changed files'}
          className="size-7"
          aria-pressed={filesOpen}
          onClick={() => setFilesOpen((open) => !open)}
        >
          <FolderTree size={14} />
        </IconButton>
        {onClose && (
          <IconButton label="Close review pane" className="size-7" onClick={onClose}>
            <PanelRightClose size={14} />
          </IconButton>
        )}
      </header>
      {(reviewError || branchError) && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {reviewError || branchError}
        </p>
      )}
      {actionsOpen && source.kind === 'working' && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-b">
          <ReviewCommentsTray task={task} className="p-2" />
          <ReviewFindings
            task={task}
            className="p-2"
            onOpen={(finding) => {
              if (task.files.some((item) => item.path === finding.path)) setSelected(finding.path)
            }}
          />
          <CommitBar task={task} />
          {file && <DiskActions task={task} file={file} />}
          {file && <ReviewFeedback key={file.path} task={task} file={file} />}
        </div>
      )}
      {branchLoading && source.kind === 'branch' ? (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          Loading branch changes…
        </p>
      ) : file ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ErrorBoundary key={task.id + file.path}>
              {file.preview ? (
                <SavedFilePreview
                  key={`${sourceLabel}:${file.path}`}
                  file={file}
                  taskId={task.id}
                  turnId={selectedTurn?.id}
                />
              ) : (
                <PierreEditor
                  key={`${task.id}:${sourceLabel}:${file.path}`}
                  taskId={task.id}
                  onEditingChange={editingChanged}
                  onReference={onReference}
                  readOnly={source.kind !== 'working'}
                  comments={source.kind === 'working' ? task.messages : []}
                  onComment={async (body, range) => {
                    const excerpt = (range.side === 'additions' ? file.after : file.before)
                      .split('\n')
                      .slice(range.start - 1, range.end)
                      .join('\n')
                    await request(
                      '/api/tasks/feedback',
                      {
                        id: task.id,
                        path: file.path,
                        body,
                        excerpt,
                        ...range,
                      },
                      responses.ok,
                    )
                    setActionsOpen(true)
                  }}
                  file={file}
                  onSave={(after) =>
                    setWorkspace((w) =>
                      updateTask(w, task.id, (t) => ({
                        ...t,
                        files: t.files.map((f) =>
                          f.path === file.path
                            ? {
                                ...f,
                                diskContents: f.diskContents ?? f.after,
                                after,
                                viewed: f.after === after && f.viewed,
                              }
                            : f,
                        ),
                      })),
                    )
                  }
                />
              )}
            </ErrorBoundary>
          </div>
          {filesOpen && (
            <FileTree files={files} stats={stats} selected={file.path} onSelect={setSelected} />
          )}
        </div>
      ) : (
        <EmptyState
          icon={<FileDiff />}
          title={branchError ? 'Diff unavailable' : 'No changed files'}
          description={
            source.kind === 'working'
              ? 'Changes will appear here when a connected agent produces them.'
              : source.kind === 'branch'
                ? 'No committed changes since the default branch.'
                : 'This turn has no text changes to preview.'
          }
        />
      )}
    </section>
  )
}

export function ReviewPane(props: Parameters<typeof PrimaryReviewPane>[0]) {
  const { workspace } = useWorkspace()
  const [checkoutId, setCheckoutId] = useApplicationState('')
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!!props.task.linkedCheckouts?.length && (
        <ChoicePicker
          aria-label="Review project checkout"
          value={checkoutId}
          onValueChange={setCheckoutId}
        >
          <option value="">Primary checkout</option>
          {props.task.linkedCheckouts.map((link) => (
            <option key={link.id} value={link.id}>
              {workspace.repositories.find((repo) => repo.id === link.repositoryId)?.name ??
                link.repositoryId}{' '}
              · {link.branch ?? link.execution}
            </option>
          ))}
        </ChoicePicker>
      )}
      {checkoutId && props.task.linkedCheckouts?.some((link) => link.id === checkoutId) ? (
        <LinkedReview
          key={`${props.task.id}:${checkoutId}`}
          task={props.task}
          checkoutId={checkoutId}
        />
      ) : (
        <PrimaryReviewPane {...props} />
      )}
    </div>
  )
}
