import { useMemo } from 'react'
import {
  changedFileFingerprint,
  checkpointFiles,
  createReviewFileLookup,
  orderReviewFiles,
} from '@dovo/protocol'
import { useFileReview } from '@dovo/studio-core'
import { OrganizeReview, FileReviewControls, ReviewFiles } from '@dovo/studio-ui'
import { useEffect, useState } from 'react'
import { useWorkspace, responses, updateTask, type Task, type ChangedFile } from '@dovo/studio-core'
import { Button, ChoicePicker } from '@dovo/studio-ui'
import { SavedFilePreview } from '../files/saved-file-preview'
import { LocalCommitPicker } from './local-commit-picker'
import type { LocalCommit } from '@dovo/protocol'
import { CheckpointDiff } from '../chat/thread/turn-checkpoint'

export function LinkedReview({ task, checkoutId }: { task: Task; checkoutId: string }) {
  const { request, workspace, setWorkspace, connected, activeRuntimeId, connection } =
    useWorkspace()
  const [turnId, setTurnId] = useState('')
  const [commit, setCommit] = useState<LocalCommit | null>(null)
  const commitKey = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    task.id,
    checkoutId,
    commit?.sha,
  ])
  const [commitResult, setCommitResult] = useState<{
    key: string
    files: ChangedFile[]
    error: string
  }>()
  const commitDiff = commitResult?.key === commitKey ? commitResult : undefined
  const [path, setPath] = useState('')
  const [live, setLive] = useState<ChangedFile[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const history = task.turns
    ?.find((turn) => turn.id === turnId)
    ?.checkpoint?.linked?.find((item) => item.checkoutId === checkoutId)
  const sourceFiles = useMemo(
    () =>
      commit
        ? (commitDiff?.files ?? [])
        : turnId
          ? history
            ? checkpointFiles(history)
            : []
          : live,
    [commit, commitDiff, turnId, history, live],
  )
  const fingerprints = useMemo(
    () => new Map(sourceFiles.map((file) => [file.path, changedFileFingerprint(file)])),
    [sourceFiles],
  )
  const reviewVersion = useMemo(() => JSON.stringify([...fingerprints]), [fingerprints])
  const review = useFileReview(
    {
      kind: 'task',
      taskId: task.id,
      checkoutId,
      source: commit ? 'commit' : turnId ? 'turn' : 'working',
      commitSha: commit?.sha,
      turnId: turnId || undefined,
    },
    reviewVersion,
  )
  const fileState = useMemo(() => createReviewFileLookup(review.progress), [review.progress?.files])
  const [related, setRelated] = useState(true)
  const files = useMemo(
    () =>
      orderReviewFiles(
        sourceFiles.map((file) => ({
          ...file,
          viewed: fileState(file.path, fingerprints.get(file.path) ?? '')?.viewed ?? false,
        })),
        review.progress?.groups ?? [],
        related,
      ),
    [sourceFiles, fingerprints, review.progress, related, fileState],
  )
  const file = files.find((item) => item.path === path) ?? files[0]
  const link = task.linkedCheckouts?.find((item) => item.id === checkoutId)
  const name =
    workspace.repositories.find((repo) => repo.id === link?.repositoryId)?.name ?? 'Linked checkout'
  useEffect(() => {
    if (turnId || commit || !connected) return
    let active = true
    setLoading(true)
    setError('')
    void request('/api/tasks/checkouts/changes', { id: task.id, checkoutId }, responses.files).then(
      (result) => {
        if (active) {
          setLive(result.files)
          setLoading(false)
        }
      },
      (error: unknown) => {
        if (active) {
          setError(error instanceof Error ? error.message : String(error))
          setLoading(false)
        }
      },
    )
    return () => {
      active = false
    }
  }, [request, task.id, checkoutId, turnId, commit, connected, refresh])
  useEffect(() => {
    if (!commit || !connected) return
    let active = true
    setCommitResult(undefined)
    void request(
      '/api/tasks/commits/changes',
      { id: task.id, checkoutId, sha: commit.sha },
      responses.files,
    ).then(
      (result) => {
        if (active) setCommitResult({ key: commitKey, files: result.files, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setCommitResult({
            key: commitKey,
            files: [],
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, task.id, checkoutId, commit, commitKey, connected, refresh])
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
      aria-label="Linked checkout changes"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChoicePicker
          aria-label="Linked change history"
          value={commit ? `commit:${commit.sha}` : turnId}
          onValueChange={(id) => {
            if (id.startsWith('commit:')) return
            setCommit(null)
            setTurnId(id)
            setPath('')
          }}
        >
          <option value="">Current changes</option>
          {commit && (
            <option value={`commit:${commit.sha}`}>
              Commit {commit.sha.slice(0, 8)} · {commit.subject}
            </option>
          )}
          {task.turns
            ?.filter((turn) =>
              turn.checkpoint?.linked?.some((item) => item.checkoutId === checkoutId),
            )
            .map((turn, index) => (
              <option key={turn.id} value={turn.id}>
                Turn {index + 1} · {turn.status}
              </option>
            ))}
        </ChoicePicker>
        <LocalCommitPicker
          taskId={task.id}
          checkoutId={checkoutId}
          disabled={!!task.example}
          onSelect={(selected) => {
            setCommit(selected)
            setTurnId('')
            setPath('')
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || (!commit && loading) || !!turnId}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Reload
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={link?.access !== 'edit' || task.status === 'running' || !!task.archivedAt}
          onClick={() =>
            setWorkspace((workspace) =>
              updateTask(workspace, task.id, (current) => ({
                ...current,
                draft: [
                  current.draft,
                  `Create a separate pull request for the linked project ${JSON.stringify(name)} (checkout ID ${checkoutId}). Run Git and gh from that linked checkout. Preserve the primary project's PR.`,
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              })),
            )
          }
        >
          Draft PR request
        </Button>
        <span className="text-xs text-muted-foreground">{files.length} files</span>
      </div>
      {commit && (
        <p className="text-xs text-muted-foreground">
          {commit.subject} · Read-only changes against the first parent.
        </p>
      )}
      {commit && !commitDiff && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading commit changes…
        </p>
      )}
      {commit && commitDiff?.error && (
        <p role="alert" className="text-xs text-destructive">
          {commitDiff.error}
        </p>
      )}
      {(error || history?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || history?.error}
        </p>
      )}
      {!commit && loading && <p className="text-xs text-muted-foreground">Loading changes…</p>}
      <OrganizeReview onOpenFile={setPath} review={review} onOrganized={() => setRelated(true)} />
      <FileReviewControls
        files={files}
        selected={file?.path ?? ''}
        onSelect={setPath}
        onViewed={(viewed) => {
          if (file) review.setViewed(file.path, fingerprints.get(file.path) ?? '', viewed)
        }}
        disabled={
          !review.ready || !file || !fileState(file.path, fingerprints.get(file.path) ?? '')
        }
        busy={review.busy}
        error={review.error}
        onRetry={review.reload}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <aside className="flex max-h-48 min-h-0 shrink-0 flex-col overflow-hidden rounded border md:max-h-none md:w-64">
          <ReviewFiles
            files={files}
            groups={review.progress?.groups ?? []}
            related={related}
            onRelatedChange={setRelated}
            selected={file?.path ?? ''}
            onSelect={setPath}
          />
        </aside>
        <div className="studio-code min-h-0 flex-1 overflow-auto rounded-md border">
          {file ? (
            file.preview ? (
              <SavedFilePreview
                key={`${checkoutId}:${turnId}:${file.path}`}
                file={file}
                taskId={task.id}
                turnId={turnId || undefined}
                commitSha={commit?.sha}
                working={!turnId && !commit}
                checkoutId={checkoutId}
              />
            ) : (
              <CheckpointDiff file={file} />
            )
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No changed files.</p>
          )}
        </div>
      </div>
    </section>
  )
}
