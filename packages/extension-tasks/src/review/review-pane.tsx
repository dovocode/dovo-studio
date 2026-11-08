import { useTaskReview } from './use-task-review'
import { LocalCommitPicker } from './local-commit-picker'
import { CodeReviewReport, type ReviewTab } from './code-review-report'
import type { CodeFinding } from '@dovo/protocol'
import { changedFileFingerprint, createReviewFileLookup, orderReviewFiles } from '@dovo/protocol'
import { useFileReview } from '@dovo/studio-core'
import { OrganizeReview, FileReviewControls } from '@dovo/studio-ui'
import { useAppPreferences, whitespaceOnlyFile } from '@dovo/studio-core'
import { LinkedReview } from './linked-review'
import { ChoicePicker } from '@dovo/studio-ui'
import { SavedFilePreview } from '../files/saved-file-preview'
import { randomUUID, checkpointFiles } from '@dovo/protocol'
import { fileStats } from '../files/presentation'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useMemo, useRef, useEffect } from 'react'
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
  SlidersHorizontal,
} from 'lucide-react'
import { pendingReviewComments, reviewFindings } from '@dovo/protocol'
import { ReviewFindings } from '../chat/thread/review-findings'
import { CommitBar } from './commit-bar'
import { useWorkspace, responses, updateTask, type ChangedFile, type Task } from '@dovo/studio-core'
import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  ErrorBoundary,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@dovo/studio-ui'
import { FileTree } from './file-tree'
import { PierreEditor } from './pierre-editor'
import { ReviewFeedback } from './review-feedback'
import { ReviewCommentsTray } from '../chat/thread/review-comments-tray'
type DiffSource =
  | { kind: 'working' | 'branch' | 'latest' }
  | { kind: 'turn' | 'review'; id: string }
  | { kind: 'commit'; id: string; subject: string }
function PrimaryReviewPane({
  task,
  onClose,
  onReference,
  onEditingChange,
  initialFinding,
  initialTab = 'diff',
}: {
  task: Task
  initialFinding?: { path: string; line: number }
  initialTab?: ReviewTab
  onEditingChange?: (editing: boolean) => void
  onClose?: () => void
  onReference?: (text: string) => void
}) {
  const { hideWhitespaceChanges } = useAppPreferences()
  const { setWorkspace, request, connected, snapshot, activeRuntimeId, connection } = useWorkspace()
  const [selected, setSelected] = useApplicationState(initialFinding?.path ?? '')
  const [focusedFinding, setFocusedFinding] = useApplicationState(initialFinding)
  const [requestedTab, setTab] = useApplicationState<ReviewTab>(initialTab)
  const tab = snapshot?.codeReviewsEnabled ? requestedTab : 'diff'
  const codeReview = useTaskReview(
    task.id,
    JSON.stringify([
      task.status,
      task.files.map((file) => [file.path, changedFileFingerprint(file)]),
    ]),
    !task.example,
  )
  const [contextPreview, setContextPreview] = useApplicationState<{
    path: string
    line: number
    contents: string
  } | null>(null)
  const [reviewDiff, setReviewDiff] = useApplicationState<{
    files: ChangedFile[]
    omitted: string[]
  } | null>(null)
  const displayedPath = useRef('')
  const [editing, setEditing] = useApplicationState(false)
  const editingChanged = useCallback(
    (value: boolean) => {
      if (value) setSelected(displayedPath.current)
      setEditing(value)
      onEditingChange?.(value)
    },
    [onEditingChange],
  )
  const [reviewError, setReviewError] = useApplicationState('')
  const [actionsOpen, setActionsOpen] = useApplicationState(
    () => reviewFindings(task).length > 0 || pendingReviewComments(task).length > 0,
  )
  const [filesOpen, setFilesOpen] = useApplicationState(false)
  const [refreshBusy, setRefreshBusy] = useApplicationState(false)
  const [source, setSource] = useApplicationState<DiffSource>({ kind: 'working' })
  const commitSha = source.kind === 'commit' ? source.id : undefined
  const commitKey = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    task.id,
    commitSha,
  ])
  const [commitResult, setCommitResult] = useApplicationState<{
    key: string
    files: ChangedFile[]
    error: string
  } | null>(null)
  const commitDiff = commitResult?.key === commitKey ? commitResult : null
  const [commitRetry, setCommitRetry] = useApplicationState(0)
  useEffect(() => {
    if (!commitSha || !connected) return
    let active = true
    setCommitResult(null)
    void request(
      '/api/tasks/commits/changes',
      { id: task.id, sha: commitSha },
      responses.files,
    ).then(
      (result) => {
        if (active) setCommitResult({ key: commitKey, files: result.files, error: '' })
      },
      (error: unknown) => {
        if (active)
          setCommitResult({
            key: commitKey,
            files: [],
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, task.id, commitSha, commitKey, commitRetry])
  const [branchRefresh, setBranchRefresh] = useApplicationState(0)
  const [branchDiff, setBranchDiff] = useApplicationState<{
    files: ChangedFile[]
    omitted: string[]
    base: string
  } | null>(null)
  const [branchLoading, setBranchLoading] = useApplicationState(false)
  const turns = task.turns ?? []
  const selectedTurn =
    source.kind === 'latest'
      ? turns.at(-1)
      : source.kind === 'turn'
        ? turns.find((turn) => turn.id === source.id)
        : undefined
  const sourceFiles =
    source.kind === 'commit'
      ? (commitDiff?.files ?? [])
      : source.kind === 'review'
        ? (reviewDiff?.files ?? [])
        : source.kind === 'working'
          ? task.files
          : source.kind === 'branch'
            ? (branchDiff?.files ?? [])
            : (selectedTurn?.checkpoint?.files ?? [])
  const visibleFiles = useMemo(
    () =>
      checkpointFiles({
        files: sourceFiles,
        omitted:
          source.kind === 'review'
            ? (reviewDiff?.omitted ?? [])
            : source.kind === 'branch'
              ? (branchDiff?.omitted ?? [])
              : (selectedTurn?.checkpoint?.omitted ?? []),
      }).filter(
        (file) => file.path === selected || !hideWhitespaceChanges || !whitespaceOnlyFile(file),
      ),
    [
      hideWhitespaceChanges,
      selected,
      sourceFiles,
      source.kind,
      branchDiff?.omitted,
      reviewDiff?.omitted,
      selectedTurn?.checkpoint?.omitted,
    ],
  )
  const fingerprints = useMemo(
    () => new Map(visibleFiles.map((file) => [file.path, changedFileFingerprint(file)])),
    [visibleFiles],
  )
  const reviewVersion = useMemo(() => JSON.stringify([...fingerprints]), [fingerprints])
  const review = useFileReview(
    {
      kind: 'task',
      taskId: task.id,
      source:
        source.kind === 'commit'
          ? 'commit'
          : source.kind === 'review'
            ? 'working'
            : source.kind === 'working' || source.kind === 'branch'
              ? source.kind
              : 'turn',
      turnId: selectedTurn?.id,
      commitSha,
    },
    reviewVersion,
    source.kind !== 'review',
  )
  const fileState = useMemo(() => createReviewFileLookup(review.progress), [review.progress?.files])
  const [related, setRelated] = useApplicationState(true)
  const files = useMemo(
    () =>
      orderReviewFiles(
        visibleFiles.map((file) => ({
          ...file,
          viewed:
            source.kind === 'working'
              ? file.viewed
              : (fileState(file.path, fingerprints.get(file.path) ?? '')?.viewed ?? false),
        })),
        review.progress?.groups ?? [],
        related,
      ),
    [visibleFiles, fingerprints, review.progress, related, source.kind, fileState],
  )
  const file = files.find((item) => item.path === selected) ?? files[0]
  displayedPath.current = file?.path ?? ''
  const pendingDraft =
    source.kind === 'working' &&
    file?.diskContents !== undefined &&
    file.diskContents !== file.after
  const chooseFile = (path: string) => {
    if (!editing) {
      setSelected(path)
      setFocusedFinding(undefined)
    }
  }
  const sourceLabel =
    source.kind === 'commit'
      ? `Commit ${source.id.slice(0, 8)}`
      : source.kind === 'review'
        ? 'Since last review'
        : source.kind === 'working'
          ? 'Working tree'
          : source.kind === 'branch'
            ? 'Branch + local edits'
            : source.kind === 'latest'
              ? 'Latest turn'
              : `Turn ${turns.findIndex((turn) => turn.id === (source.kind === 'turn' ? source.id : '')) + 1}`
  // Kept out of sourceLabel, which also keys the file rows.
  const baseLabel =
    source.kind === 'branch' && branchDiff?.base
      ? /^[a-f0-9]{40,64}$/.test(branchDiff.base)
        ? branchDiff.base.slice(0, 8)
        : branchDiff.base.replace(/^refs\/(heads|remotes)\//, '')
      : ''
  const refreshBranch = useCallback(async () => {
    try {
      const result = await request(
        '/api/scm/branch-changes',
        { repositoryId: task.repositoryId, taskId: task.id, includeWorking: true },
        responses.branchDiff,
      )
      setBranchDiff(result)
    } finally {
      setBranchLoading(false)
    }
  }, [request, task.repositoryId, task.id, branchRefresh])
  const branchError = useLiveRefresh(connected && source.kind === 'branch', refreshBranch)
  const chooseSource = (next: DiffSource) => {
    if (editing) return
    setSelected('')
    if (next.kind === 'branch') {
      setBranchRefresh((value) => value + 1)
      setBranchDiff(null)
      setBranchLoading(true)
    }
    setSource(next)
  }
  const sinceReview = async (id: string) => {
    if (editing) return
    setReviewError('')
    setRefreshBusy(true)
    try {
      const result = await request(
        '/api/review/task/changes',
        { taskId: task.id, reviewId: id },
        responses.files,
      )
      setReviewDiff({ files: result.files, omitted: [] })
      setSelected('')
      setFocusedFinding(undefined)
      setSource({ kind: 'review', id })
      setTab('diff')
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshBusy(false)
    }
  }
  const openFinding = (finding: CodeFinding) => {
    if (editing) return
    if (!sourceFiles.some((file) => file.path === finding.path)) {
      void request(
        '/api/tasks/files/read',
        { id: task.id, path: finding.path },
        responses.projectFile,
      ).then(
        (result) => setContextPreview({ ...result, line: finding.line }),
        (error) => setReviewError(error instanceof Error ? error.message : String(error)),
      )
      return
    }
    if (source.kind !== 'branch') setSource({ kind: 'working' })
    setSelected(finding.path)
    setFocusedFinding(finding)
    setTab('findings')
  }
  useEffect(() => {
    if (initialFinding && !task.files.some((file) => file.path === initialFinding.path))
      void request(
        '/api/tasks/files/read',
        { id: task.id, path: initialFinding.path },
        responses.projectFile,
      ).then(
        (result) => setContextPreview({ ...result, line: initialFinding.line }),
        (error) => setReviewError(error instanceof Error ? error.message : String(error)),
      )
  }, [initialFinding, request, task.id])
  const stats = useMemo(() => visibleFiles.map(fileStats), [visibleFiles])
  const additions = stats.reduce((total, item) => total + item.additions, 0)
  const deletions = stats.reduce((total, item) => total + item.deletions, 0)
  return (
    <section
      className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label="Diff"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-md bg-muted/50 px-2.5 text-xs font-medium"
              disabled={editing}
              aria-label={`Diff source: ${sourceLabel}${baseLabel ? ` since ${baseLabel}` : ''}`}
            >
              {sourceLabel}
              {baseLabel && (
                <span className="max-w-40 truncate text-muted-foreground">since {baseLabel}</span>
              )}{' '}
              <ChevronDown className="size-3.5 text-muted-foreground" />
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
                title="All changes since this thread's base branch, including local edits"
                onSelect={() => chooseSource({ kind: 'branch' })}
              >
                Branch + local edits{' '}
                {source.kind === 'branch' && <Check className="ml-auto size-3.5" />}
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
        <LocalCommitPicker
          taskId={task.id}
          disabled={editing || !!task.example}
          onSelect={(commit) => {
            chooseSource({ kind: 'commit', id: commit.sha, subject: commit.subject })
            setTab('diff')
          }}
        />
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="hidden text-[0.6875rem] tabular-nums sm:inline">
          <span className="text-status-success">+{additions}</span>{' '}
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
        <IconButton
          label={actionsOpen ? 'Hide diff actions' : 'Show diff actions'}
          className="size-7"
          aria-pressed={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <SlidersHorizontal size={14} />
        </IconButton>
        <IconButton
          label={filesOpen ? 'Hide change map' : 'Show change map'}
          className="size-7"
          aria-pressed={filesOpen}
          onClick={() => setFilesOpen((open) => !open)}
        >
          <FolderTree size={14} />
        </IconButton>
        {onClose && (
          <IconButton
            label="Close review pane"
            className="size-7"
            onClick={onClose}
            disabled={editing}
            title={editing ? 'Save or cancel your edit before closing' : undefined}
          >
            <PanelRightClose size={14} />
          </IconButton>
        )}
      </header>
      <CodeReviewReport
        presentation="controls"
        scope={
          source.kind === 'branch' ||
          (source.kind === 'review' && codeReview.report?.reviews[0]?.scope === 'branch')
            ? 'branch'
            : 'working'
        }
        task={task}
        review={codeReview}
        tab={tab}
        onTab={(next) => {
          if (!editing) setTab(next)
        }}
        onOpen={openFinding}
        onSince={(id) => void sinceReview(id)}
      />
      <div
        className={
          tab === 'findings'
            ? 'flex min-h-0 flex-1 flex-col @[700px]:flex-row'
            : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {filesOpen && (
            <OrganizeReview
              onOpenFile={chooseFile}
              review={review}
              disabled={editing || !!task.example || source.kind === 'review'}
              onOrganized={() => setRelated(true)}
            />
          )}
          <FileReviewControls
            files={files}
            selected={file?.path ?? ''}
            onSelect={chooseFile}
            onViewed={(viewed) => {
              if (file) review.setViewed(file.path, fingerprints.get(file.path) ?? '', viewed)
            }}
            disabled={
              !review.ready ||
              editing ||
              !!task.example ||
              !file ||
              !fileState(file.path, fingerprints.get(file.path) ?? '')
            }
            busy={review.busy}
            navigationDisabled={editing}
            error={review.error}
            onRetry={review.reload}
          />
          {pendingDraft && file && (
            <div className="shrink-0 border-b">
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                Saved draft pending. Apply it to disk or reload the file to continue.
              </p>
              <DiskActions task={task} file={file} />
            </div>
          )}
          {source.kind === 'commit' && (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              {source.subject} · Read-only changes against the first parent.
            </p>
          )}
          {source.kind === 'commit' && commitDiff?.error && (
            <div className="border-b px-3 py-2">
              <p role="alert" className="text-xs text-destructive">
                {commitDiff.error}
              </p>
              <Button size="sm" onClick={() => setCommitRetry((value) => value + 1)}>
                Retry commit changes
              </Button>
            </div>
          )}
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
                  if (task.files.some((item) => item.path === finding.path))
                    chooseFile(finding.path)
                }}
              />
              <CommitBar task={task} />
              {file && !pendingDraft && <DiskActions task={task} file={file} />}
              {file && <ReviewFeedback key={file.path} task={task} file={file} />}
            </div>
          )}
          {source.kind === 'commit' && !commitDiff ? (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              Loading commit changes…
            </p>
          ) : branchLoading && source.kind === 'branch' ? (
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
                      commitSha={commitSha}
                      working={source.kind === 'working'}
                    />
                  ) : (
                    <PierreEditor
                      key={`${task.id}:${sourceLabel}:${file.path}`}
                      taskId={task.id}
                      onEditingChange={editingChanged}
                      onReference={onReference}
                      readOnly={source.kind !== 'working'}
                      findings={
                        (source.kind === 'working' || source.kind === 'branch') &&
                        codeReview.report?.current
                          ? (codeReview.report.reviews[0]?.findings.filter(
                              (finding) =>
                                finding.status === 'open' || finding.status === 'addressed',
                            ) ?? [])
                          : []
                      }
                      focusedLine={
                        focusedFinding?.path === file.path ? focusedFinding.line : undefined
                      }
                      onFixFinding={(finding) => {
                        const latest = codeReview.report?.reviews[0]
                        if (latest)
                          void codeReview.run('fix', {
                            reviewId: latest.id,
                            findingIds: [finding.id],
                            messageId: randomUUID(),
                          })
                      }}
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
                <FileTree
                  files={files}
                  stats={stats}
                  weightBy={selectedTurn ? 'lines' : 'files'}
                  selected={file.path}
                  onSelect={chooseFile}
                  groups={review.progress?.groups ?? []}
                  related={related}
                  onRelatedChange={setRelated}
                  disabled={editing}
                />
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
                    ? 'No branch or local changes since the default branch.'
                    : source.kind === 'review'
                      ? 'No file changes since this review snapshot.'
                      : source.kind === 'commit'
                        ? 'This commit has no changes against its first parent.'
                        : 'This turn has no text changes to preview.'
              }
            />
          )}
        </div>
        {tab !== 'diff' && (
          <aside
            aria-label={tab === 'findings' ? 'Findings beside diff' : 'Verification beside diff'}
            className={
              tab === 'findings'
                ? 'flex max-h-[45%] min-h-0 shrink-0 flex-col border-t @[700px]:max-h-none @[700px]:w-80 @[700px]:max-w-[40%] @[700px]:border-l @[700px]:border-t-0'
                : 'flex max-h-[40%] min-h-0 shrink-0 flex-col border-t'
            }
          >
            <CodeReviewReport
              presentation="panel"
              task={task}
              review={codeReview}
              tab={tab}
              onTab={setTab}
              onOpen={openFinding}
              onSince={(id) => void sinceReview(id)}
            />
          </aside>
        )}
      </div>
      <Dialog
        open={!!contextPreview}
        onOpenChange={(open) => {
          if (!open) setContextPreview(null)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle>
            {contextPreview?.path}:{contextPreview?.line}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Surrounding code · unchanged file</p>
          <pre className="max-h-[60vh] overflow-auto text-xs">
            {contextPreview?.contents
              .split('\n')
              .slice(Math.max(0, contextPreview.line - 11), contextPreview.line + 10)
              .map((line, index) => (
                <span
                  key={index}
                  className={
                    Math.max(0, contextPreview.line - 11) + index + 1 === contextPreview.line
                      ? 'block bg-accent'
                      : 'block'
                  }
                >
                  {Math.max(0, contextPreview.line - 11) + index + 1} {line}
                </span>
              ))}
          </pre>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function ReviewPane(props: Parameters<typeof PrimaryReviewPane>[0]) {
  const { workspace } = useWorkspace()
  const [checkoutId, setCheckoutId] = useApplicationState('')
  const [editing, setEditing] = useApplicationState(false)
  const editingChanged = useCallback(
    (value: boolean) => {
      setEditing(value)
      props.onEditingChange?.(value)
    },
    [props.onEditingChange],
  )
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!!props.task.linkedCheckouts?.length && (
        <ChoicePicker
          aria-label="Review project checkout"
          disabled={editing}
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
        <PrimaryReviewPane {...props} onEditingChange={editingChanged} />
      )}
    </div>
  )
}
