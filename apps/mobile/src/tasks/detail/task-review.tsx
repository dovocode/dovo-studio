import { useTaskReview } from '../../scm/review/use-task-review'
import { LocalCommitPicker } from './local-commit-picker'
import { CodeReviewReport, type ReviewTab } from '../../scm/review/code-review-report'
import type { CodeFinding } from '@dovo/protocol'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { pendingReviewComments } from '@dovo/protocol'
import {
  changedFileFingerprint,
  createReviewFileLookup,
  orderReviewFiles,
  pullFileKind,
} from '@dovo/protocol'
import { useFileReview } from '../../scm/review/use-file-review'
import { MobileOrganizeReview } from '../../scm/review/organize-review'
import { MobileFileReview } from '../../scm/review/file-review'
import { useConversationSelector } from '../conversation/state/provider'
import { SavedFilePreview } from '../files/saved-file-preview'
import { checkpointFiles, filePreviewLabel } from '@dovo/protocol'
import { fileStats } from '../files/stats'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { Choice } from '../../ui/controls/choice'
import { useMemo, useEffect, useState, useRef } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { DiffView } from '../preview/diff-view'
import { PullStatus } from './pull-status'
import { CommitSection } from './commit-section'
export type FileEditDraft = { path: string; contents: string; expected: string }
export function TaskReview({
  initialCheckpoint = '',
  initialPath = '',
  initialCheckoutId = '',
  initialLine,
  initialTab = 'diff',
  edit,
  onEditChange: setEdit,
}: {
  initialCheckpoint?: string
  initialPath?: string
  initialCheckoutId?: string
  initialLine?: number
  initialTab?: ReviewTab
  edit: FileEditDraft | null
  onEditChange: (draft: FileEditDraft | null) => void
}) {
  const { styles, code } = useTheme()

  const task = useConversationSelector((value) => value.task)
  const { call, read, connected, callEffect, snapshot, connection } = useRuntime(),
    { busy, error, act } = useAction()
  const tools = useRef<SheetHandle>(null)
  const [checkpoint, setCheckpoint] = useApplicationState(initialCheckpoint)
  const [checkoutId, setCheckoutId] = useState(initialCheckoutId)
  const [commit, setCommit] = useState<{ sha: string; subject: string } | null>(null)
  const commitKey = JSON.stringify([
    connection?.address,
    connection?.token,
    task.id,
    checkoutId,
    commit?.sha,
  ])
  const [commitResult, setCommitResult] = useState<{
    key: string
    files: Task['files']
    error: string
  }>()
  const commitDiff = commitResult?.key === commitKey ? commitResult : undefined
  const [commitRetry, setCommitRetry] = useState(0)
  useEffect(() => {
    if (!commit || !connected) return
    let active = true
    setCommitResult(undefined)
    void read(
      '/api/tasks/commits/changes',
      { id: task.id, checkoutId: checkoutId || undefined, sha: commit.sha },
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
  }, [read, connected, task.id, checkoutId, commit, commitKey, commitRetry])
  const [requestedTab, setTab] = useState<ReviewTab>(initialTab)
  const tab = snapshot?.codeReviewsEnabled ? requestedTab : 'diff'
  const codeReview = useTaskReview(
    task.id,
    JSON.stringify([
      task.status,
      task.files.map((file) => [file.path, changedFileFingerprint(file)]),
    ]),
    !task.example,
  )
  const [scope, setScope] = useState<'working' | 'branch'>('working')
  const [branchFiles, setBranchFiles] = useState<Task['files']>([])
  const [branchError, setBranchError] = useState('')
  const [focusedFinding, setFocusedFinding] = useState<CodeFinding>()
  useEffect(() => {
    if (scope !== 'branch' || !connected) return
    let active = true
    setBranchError('')
    void call(
      '/api/scm/branch-changes',
      { repositoryId: task.repositoryId, taskId: task.id, includeWorking: true },
      responses.branchDiff,
    ).then(
      (result) => {
        if (active) setBranchFiles(result.files)
      },
      (error: unknown) => {
        if (active) setBranchError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      active = false
    }
  }, [scope, connected, call, task.id, task.repositoryId, task.files])
  const [since, setSince] = useState<{ id: string; files: Task['files'] } | null>(null)
  const [contextPreview, setContextPreview] = useState<{
    path: string
    line: number
    contents: string
  } | null>(null)
  const [contextError, setContextError] = useState('')
  const [focusedLine, setFocusedLine] = useState(initialLine)
  const [comment, setComment] = useState<{
    line: number
    side: 'additions' | 'deletions'
    body: string
  } | null>(null)
  const selectedTurn = task.turns?.find((turn) => turn.id === checkpoint)?.checkpoint
  const linkedHistory = selectedTurn?.linked?.find((item) => item.checkoutId === checkoutId)
  const history = checkoutId ? linkedHistory : selectedTurn
  const [linkedFiles, setLinkedFiles] = useState<{
    key: string
    files: Task['files']
    error: string
  } | null>(null)
  const loadKey = `${task.id}:${checkoutId}`
  useEffect(() => {
    if (!checkoutId || checkpoint || commit) return
    let active = true
    void call('/api/tasks/checkouts/changes', { id: task.id, checkoutId }, responses.files).then(
      (result) => {
        if (active) setLinkedFiles({ key: loadKey, files: result.files, error: '' })
      },
      (error: unknown) => {
        if (active)
          setLinkedFiles({
            key: loadKey,
            files: [],
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [call, task.id, checkoutId, checkpoint, commit, loadKey])
  const sourceFiles = useMemo(
    () =>
      commit
        ? (commitDiff?.files ?? [])
        : since
          ? since.files
          : checkpoint
            ? history
              ? checkpointFiles(history)
              : []
            : checkoutId
              ? linkedFiles?.key === loadKey
                ? linkedFiles.files
                : []
              : scope === 'branch'
                ? branchFiles
                : task.files,
    [
      commit,
      commitDiff,
      checkpoint,
      history,
      task.files,
      checkoutId,
      linkedFiles,
      loadKey,
      since,
      scope,
      branchFiles,
    ],
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
      source: commit ? 'commit' : checkpoint ? 'turn' : scope,
      commitSha: commit?.sha,
      turnId: checkpoint || undefined,
      checkoutId: checkoutId || undefined,
    },
    reviewVersion,
    !since,
  )
  const fileState = useMemo(() => createReviewFileLookup(review.progress), [review.progress?.files])
  const [related, setRelated] = useState(true),
    [toolsOpen, setToolsOpen] = useState(false),
    [wrapLines, setWrapLines] = useState(false)
  const files = useMemo(
    () =>
      orderReviewFiles(
        sourceFiles.map((file) => ({
          ...file,
          viewed:
            !commit && !checkpoint && !checkoutId && scope === 'working'
              ? file.viewed
              : (fileState(file.path, fingerprints.get(file.path) ?? '')?.viewed ?? false),
        })),
        review.progress?.groups ?? [],
        related,
      ),
    [
      sourceFiles,
      fingerprints,
      fileState,
      review.progress,
      related,
      commit,
      checkpoint,
      checkoutId,
      scope,
    ],
  )
  const stats = useMemo(
    () => new Map(sourceFiles.map((file) => [file.path, fileStats(file)])),
    [sourceFiles],
  )
  const [path, setPath] = useApplicationState(edit?.path ?? initialPath)
  const file = files.find((file) => file.path === path) ?? files[0]
  const patch = useMemo(
    () =>
      file && !file.preview
        ? createTwoFilesPatch(file.path, file.path, file.before, file.after, undefined, undefined, {
            headerOptions: FILE_HEADERS_ONLY,
          })
        : '',
    [file?.path, file?.preview, file?.before, file?.after],
  )
  const refresh = () =>
    call(
      checkoutId
        ? '/api/tasks/checkouts/changes'
        : scope === 'branch'
          ? '/api/scm/branch-changes'
          : '/api/scm/changes',
      checkoutId
        ? { id: task.id, checkoutId }
        : { repositoryId: task.repositoryId, taskId: task.id, includeWorking: scope === 'branch' },
      responses.files,
    )
  const openFinding = (finding: CodeFinding) => {
    setCommit(null)
    setFocusedFinding(finding)
    if (!sourceFiles.some((file) => file.path === finding.path)) {
      act(async () => {
        const result = await call(
          '/api/tasks/files/read',
          { id: task.id, path: finding.path },
          responses.projectFile,
        )
        setContextPreview({ ...result, line: finding.line })
      })
      return
    }
    setSince(null)
    setCheckpoint('')
    setCheckoutId('')
    setPath(finding.path)
    setFocusedLine(finding.line)
    setTab('diff')
  }
  useEffect(() => {
    let active = true
    setContextError('')
    if (initialPath && initialLine && !task.files.some((file) => file.path === initialPath))
      void call(
        '/api/tasks/files/read',
        { id: task.id, path: initialPath },
        responses.projectFile,
      ).then(
        (result) => {
          if (active) setContextPreview({ ...result, line: initialLine })
        },
        (error: unknown) => {
          if (active) setContextError(error instanceof Error ? error.message : String(error))
        },
      )
    return () => {
      active = false
    }
  }, [initialPath, initialLine, task.id, call])
  const sinceReview = (reviewId: string) =>
    act(async () => {
      setCommit(null)
      const result = await call(
        '/api/review/task/changes',
        { taskId: task.id, reviewId },
        responses.files,
      )
      setSince({ id: reviewId, files: result.files })
      setCheckpoint('')
      setCheckoutId('')
      setPath('')
      setFocusedLine(undefined)
      setTab('diff')
    })
  return (
    <View style={styles.screen}>
      <PullStatus task={task} />
      <CodeReviewReport
        task={task}
        review={codeReview}
        tab={tab}
        onTab={setTab}
        onOpen={openFinding}
        onSince={sinceReview}
        editing={!!edit}
        scope={scope}
        focusedFinding={focusedFinding}
        onScope={(next) => {
          setCommit(null)
          setScope(next)
          setSince(null)
          setCheckpoint('')
          setCheckoutId('')
          setPath('')
          setFocusedLine(undefined)
          setFocusedFinding(undefined)
          setBranchFiles([])
        }}
      />
      {!!branchError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {branchError}
        </Text>
      )}
      <View style={tab === 'diff' ? { flex: 1, minHeight: 0 } : { display: 'none' }}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 2, gap: 4 }}>
          {!!(checkpoint ? selectedTurn?.linked?.length : task.linkedCheckouts?.length) && (
            <Choice
              label="Project checkout"
              value={checkoutId}
              disabled={!!edit}
              items={[
                { id: '', name: 'Primary checkout' },
                ...((checkpoint
                  ? selectedTurn?.linked?.map((item) => ({
                      id: item.checkoutId,
                      name: `${item.repositoryName ?? item.repositoryId} · ${item.branch ?? 'Linked checkout'}`,
                    }))
                  : task.linkedCheckouts?.map((item) => ({
                      id: item.id,
                      name: `${snapshot?.workspace.repositories.find((repo) => repo.id === item.repositoryId)?.name ?? item.repositoryId} · ${item.branch ?? item.execution}`,
                    }))) ?? []),
              ]}
              onChange={(id) => {
                setCommit(null)
                setSince(null)
                setCheckoutId(id)
                setPath('')
              }}
            />
          )}
          {!!checkoutId && !checkpoint && linkedFiles?.key === loadKey && !!linkedFiles.error && (
            <Text style={styles.error}>{linkedFiles.error}</Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Choice
                compact
                hideLabel
                label="Change history"
                value={commit ? `commit:${commit.sha}` : since ? 'review' : checkpoint}
                disabled={!!edit}
                items={[
                  {
                    id: '',
                    name: 'Current changes',
                  },
                  ...(since ? [{ id: 'review', name: 'Since last review' }] : []),
                  ...(commit
                    ? [
                        {
                          id: `commit:${commit.sha}`,
                          name: `Commit ${commit.sha.slice(0, 8)} · ${commit.subject}`,
                        },
                      ]
                    : []),
                  ...(task.turns ?? [])
                    .filter((turn) => turn.checkpoint)
                    .map((turn, index) => ({
                      id: turn.id,
                      name: `Turn ${index + 1} · ${turn.status} · ${turn.checkpoint ? checkpointFiles(turn.checkpoint).length : 0} files`,
                    })),
                ]}
                onChange={(value) => {
                  if (value === 'review' || value.startsWith('commit:')) return
                  setCommit(null)
                  setSince(null)
                  setCheckpoint(value)
                  setCheckoutId('')
                  setPath('')
                }}
              />
            </View>
            <Action
              secondary
              label="Refresh changes"
              disabled={!connected || busy || task.example || !!edit || !!checkpoint || !!commit}
              onPress={() =>
                act(async () => {
                  if (since) {
                    const result = await call(
                      '/api/review/task/changes',
                      { taskId: task.id, reviewId: since.id },
                      responses.files,
                    )
                    setSince({ ...since, files: result.files })
                    return
                  }
                  const result = await refresh()
                  if (checkoutId) setLinkedFiles({ key: loadKey, files: result.files, error: '' })
                  else if (scope === 'branch') setBranchFiles(result.files)
                  review.reload()
                })
              }
            />
            <Action
              secondary
              label="More actions"
              icon="more"
              disabled={!!edit}
              onPress={() => setToolsOpen((value) => !value)}
            />
            {edit && (
              <Action label="Cancel edit" secondary disabled={busy} onPress={() => setEdit(null)} />
            )}
          </View>
          <LocalCommitPicker
            taskId={task.id}
            checkoutId={checkoutId || undefined}
            disabled={!!edit || !!task.example}
            onSelect={(selected) => {
              setCommit({ sha: selected.sha, subject: selected.subject })
              setScope('working')
              setSince(null)
              setCheckpoint('')
              setPath('')
              setFocusedFinding(undefined)
              setFocusedLine(undefined)
              setTab('diff')
            }}
          />
          {commit && (
            <Text style={styles.muted}>
              {commit.subject} · Read-only changes against the first parent.
            </Text>
          )}
          {commit && !commitDiff && <Text>Loading commit changes…</Text>}
          {commitDiff?.error && commit && (
            <View>
              <Text accessibilityRole="alert" style={styles.error}>
                {commitDiff.error}
              </Text>
              <Action
                secondary
                label="Retry commit changes"
                onPress={() => setCommitRetry((value) => value + 1)}
              />
            </View>
          )}
          {!!history?.error && <Text style={styles.error}>{history.error}</Text>}
          {toolsOpen && (
            <Sheet
              ref={tools}
              title="Change actions"
              presentation="dialog"
              onClose={() => setToolsOpen(false)}
            >
              {since && (
                <Text style={styles.muted}>
                  Changes since this review snapshot. Select Current changes to comment or edit.
                </Text>
              )}
              {!!checkpoint && (
                <Text style={styles.muted}>
                  Snapshot diff for this turn. Select Current changes to edit files.
                </Text>
              )}

              {!commit && !checkoutId && !checkpoint && <CommitSection task={task} />}
              <MobileOrganizeReview
                onOpenFile={setPath}
                review={review}
                disabled={!!edit || !!task.example || !!since}
                onOrganized={() => setRelated(true)}
              />
              <View style={styles.row}>
                {!edit && file ? (
                  <Action
                    label="Edit file"
                    secondary
                    disabled={
                      busy ||
                      !!checkpoint ||
                      !!commit ||
                      !!checkoutId ||
                      !!file.preview ||
                      !!since ||
                      scope === 'branch'
                    }
                    onPress={() => {
                      tools.current?.dismiss(() => {
                        setPath(file.path)
                        setEdit({
                          path: file.path,
                          contents: file.after,
                          expected: file.diskContents ?? file.after,
                        })
                      })
                    }}
                  />
                ) : null}
                {file &&
                  !edit &&
                  !since &&
                  !commit &&
                  scope === 'working' &&
                  (!checkpoint || !history?.undone) && (
                    <Action
                      secondary
                      label={checkpoint ? 'Revert this file' : 'Discard file changes'}
                      disabled={!connected || busy || task.example || task.status === 'running'}
                      onPress={() =>
                        Alert.alert(
                          checkpoint ? 'Revert this file?' : 'Discard changes to this file?',
                          checkpoint
                            ? `${file.path} goes back to how it was before this turn. The current file is saved first.`
                            : `${file.path} goes back to the last commit. The current file is saved first, so this can be recovered.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: checkpoint ? 'Revert' : 'Discard',
                              style: 'destructive',
                              onPress: () =>
                                act(() =>
                                  callEffect(
                                    '/api/tasks/file/restore',
                                    {
                                      id: task.id,
                                      path: file.path,
                                      ...(checkpoint ? { turnId: checkpoint } : {}),
                                      checkoutId: checkoutId || undefined,
                                    },
                                    responses.ok,
                                  ),
                                ),
                            },
                          ],
                        )
                      }
                    />
                  )}
              </View>
            </Sheet>
          )}
        </View>
        {!!files.length && (
          <View
            style={{
              paddingHorizontal: 12,
              paddingBottom: 2,
            }}
          >
            <MobileFileReview
              files={files.map((file) => {
                const amounts = stats.get(file.path)
                return {
                  path: file.path,
                  changeKind: pullFileKind(file),
                  viewed: file.viewed,
                  label: file.preview ? filePreviewLabel(file) : undefined,
                  additions: file.preview ? undefined : (amounts?.additions ?? 0),
                  deletions: file.preview ? undefined : (amounts?.deletions ?? 0),
                }
              })}
              groups={review.progress?.groups ?? []}
              related={related}
              onRelatedChange={setRelated}
              selected={file?.path ?? ''}
              onSelect={(next) => {
                setPath(next)
                setFocusedFinding(undefined)
                setFocusedLine(undefined)
              }}
              onViewed={(viewed) => {
                if (file) review.setViewed(file.path, fingerprints.get(file.path) ?? '', viewed)
              }}
              disabled={
                !review.ready ||
                !!edit ||
                !!task.example ||
                !file ||
                !fileState(file.path, fingerprints.get(file.path) ?? '')
              }
              busy={review.busy}
              navigationDisabled={!!edit}
              wrapLines={!file?.preview && !edit ? wrapLines : undefined}
              onWrapLinesChange={setWrapLines}
              error={review.error}
              onRetry={review.reload}
            />
          </View>
        )}
        {!file && !edit ? (
          <Text style={[styles.muted, styles.content]}>No changed files.</Text>
        ) : edit ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Field
              label={edit.path}
              value={edit.contents}
              editable={!busy}
              onChangeText={(contents) =>
                setEdit({
                  ...edit,
                  contents,
                })
              }
              multiline
              autoCorrect={false}
              style={[
                styles.input,
                {
                  minHeight: 300,
                  ...(code
                    ? { color: code.colors.text, backgroundColor: code.colors.background }
                    : {}),
                  fontFamily: 'monospace',
                  textAlignVertical: 'top',
                },
              ]}
            />
            <Action
              label="Apply to disk"
              disabled={busy || !connected || task.example}
              onPress={() =>
                act(() =>
                  mobileWorkflow(function* () {
                    yield* callEffect(
                      '/api/scm/apply',
                      {
                        repositoryId: task.repositoryId,
                        taskId: task.id,
                        path: edit.path,
                        expected: edit.expected,
                        contents: edit.contents,
                      },
                      responses.ok,
                    )
                    setEdit(null)
                    yield* nativeEffect(() => refresh())
                  }),
                )
              }
            />
            <Text style={styles.muted}>
              Applies on the connected computer only if the file still matches the loaded baseline.
            </Text>
          </ScrollView>
        ) : file?.preview ? (
          <SavedFilePreview
            key={`${checkpoint}:${checkoutId}:${file.path}`}
            file={file}
            taskId={task.id}
            turnId={checkpoint || undefined}
            commitSha={commit?.sha}
            working={!checkpoint && !commit}
            checkoutId={checkoutId || undefined}
          />
        ) : (
          <DiffView
            key={`${commit?.sha ?? ''}:${checkpoint}:${checkoutId}:${file?.path}:${since?.id ?? ''}`}
            patch={patch}
            wrapLines={wrapLines}
            path={file?.path}
            before={file?.before}
            after={file?.after}
            focusedLine={focusedLine}
            onLinePress={
              !commit && !checkpoint && !checkoutId && !since && scope === 'working'
                ? (line, side) => {
                    setFocusedLine(line)
                    setComment({ line, side, body: '' })
                  }
                : undefined
            }
            annotations={
              file && !commit && !checkpoint && !since && !checkoutId && scope === 'working'
                ? pendingReviewComments(task)
                    .filter(
                      (message) =>
                        message.file === file.path &&
                        message.diffComment &&
                        (message.diffComment.side === 'additions' ? file.after : file.before)
                          .split('\n')
                          .slice(message.diffComment.start - 1, message.diffComment.end)
                          .join('\n') === message.diffComment.excerpt,
                    )
                    .flatMap((message) =>
                      message.diffComment
                        ? [
                            {
                              line: message.diffComment.start,
                              side: message.diffComment.side,
                              text: message.diffComment.body,
                            },
                          ]
                        : [],
                    )
                : []
            }
          />
        )}
      </View>
      {contextPreview && (
        <Sheet
          title={`${contextPreview.path}:${contextPreview.line}`}
          onClose={() => setContextPreview(null)}
        >
          <ScrollView>
            <Text style={styles.muted}>Surrounding code · unchanged file</Text>
            <Text selectable style={[styles.text, { fontFamily: 'monospace' }]}>
              {contextPreview.contents
                .split('\n')
                .slice(Math.max(0, contextPreview.line - 11), contextPreview.line + 10)
                .map(
                  (line, index) => `${Math.max(0, contextPreview.line - 11) + index + 1}  ${line}`,
                )
                .join('\n')}
            </Text>
          </ScrollView>
        </Sheet>
      )}
      {comment && file && (
        <Sheet title={`Comment on ${file.path}:${comment.line}`} onClose={() => setComment(null)}>
          <View style={{ gap: 12 }}>
            <Field
              label="Review comment"
              multiline
              value={comment.body}
              onChangeText={(body) => setComment({ ...comment, body })}
            />
            <Action
              label="Add comment to thread"
              disabled={!connected || busy || !comment.body.trim()}
              onPress={() =>
                act(async () => {
                  const contents = comment.side === 'additions' ? file.after : file.before
                  await call(
                    '/api/tasks/feedback',
                    {
                      id: task.id,
                      path: file.path,
                      body: comment.body,
                      side: comment.side,
                      start: comment.line,
                      end: comment.line,
                      excerpt: contents.split('\n')[comment.line - 1] ?? '',
                    },
                    responses.ok,
                  )
                  setComment(null)
                })
              }
            />
          </View>
        </Sheet>
      )}
      {!!contextError && <Text style={styles.error}>{contextError}</Text>}
      {!!error && (
        <Text
          style={[
            styles.error,
            {
              padding: 16,
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  )
}
