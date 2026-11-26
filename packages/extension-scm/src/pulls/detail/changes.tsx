import { pullCommentStatusResponse, pullDetailSchema, randomUUID } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  buildPullReviewObjective,
  pullCommentsByFile,
  type PullReviewSelection,
} from '@dovo/protocol'
import {
  pullFileFingerprint,
  createReviewFileLookup,
  orderReviewFiles,
  pullFileKind,
  githubWithheldPatch,
  type FileKind,
} from '@dovo/protocol'
import { useFileReview } from '@dovo/studio-core'
import { ChangeSummary, OrganizeReview, FileReviewControls, ReviewFiles } from '@dovo/studio-ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppPreferences, whitespaceOnlyPatch } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useWorkspace,
  pullLineCommentResponse,
  type PullDetail,
  readAppPreferences,
} from '@dovo/studio-core'
import { Button, Checkbox } from '@dovo/studio-ui'
import { PullPatch } from './patch'
import { emptyPullLineDraft, usePullLineDrafts } from './line-drafts'
import { pullReviewDraftScope } from '@dovo/studio-core/pull-code-review'
import { DeferredPullFile } from './deferred-file'
import { PullComments } from './comments'
import { createPullStateCache, useRetainedPullState, usePullStateKey } from '../retained-state'
const selectedFileCache = createPullStateCache<string>(30)
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onSteer,
  thread,
  onAskAgent,
  onPosted,
  embedded = false,
  initialFragment = '',
}: {
  /** The explicitly linked thread that receives agent feedback instead of a new task. */
  thread?: { title: string; onAsk: (objective: string) => void }
  /** Opens the explicit conversation chooser for agent feedback. */
  onAskAgent?: (selection: PullReviewSelection) => void
  embedded?: boolean
  initialFragment?: string
  detail: PullDetail
  active?: boolean
  repositoryId: string
  onSteer: (objective: string, baseline?: { headSha: string; expectedDestination?: string }) => void
  onPosted: () => void
}) {
  const uiText = useInterfaceText()

  const revision = JSON.stringify([
    repositoryId,
    detail.destination,
    detail.pull.headSha,
    detail.pull.baseSha,
  ])
  const [loaded, setLoaded] = useState<{ revision: string; files: PullDetail['files'] }>({
    revision,
    files: [],
  })
  const [loadingFile, setLoadingFile] = useState('')
  const [loadError, setLoadError] = useState('')
  const reviewFiles = useMemo(
    () =>
      detail.files.map(
        (file) =>
          (loaded.revision === revision && loaded.files.find((item) => item.path === file.path)) ||
          file,
      ),
    [detail.files, loaded, revision],
  )
  const { hideWhitespaceChanges } = useAppPreferences()
  const [guidePath, setGuidePath] = useState('')
  const visibleFiles = useMemo(
    () =>
      reviewFiles.filter(
        (file) => file.path === guidePath || !hideWhitespaceChanges || !whitespaceOnlyPatch(file),
      ),
    [reviewFiles, hideWhitespaceChanges, guidePath],
  )
  const { headSha, baseSha } = detail.pull
  const fingerprints = useMemo(
    () =>
      new Map(
        visibleFiles.map((file) => [file.path, pullFileFingerprint(file, { headSha, baseSha })]),
      ),
    [visibleFiles, headSha, baseSha],
  )
  const reviewVersion = useMemo(() => JSON.stringify([...fingerprints]), [fingerprints])
  const review = useFileReview(
    { kind: 'pull', repositoryId, number: detail.pull.number },
    reviewVersion,
    active,
  )
  const fileState = useMemo(() => createReviewFileLookup(review.progress), [review.progress?.files])
  const [kind, setKind] = useState<FileKind>()
  const [related, setRelated] = useApplicationState(true)
  const files = useMemo(
    () =>
      orderReviewFiles(
        visibleFiles.filter((file) => !kind || pullFileKind(file) === kind),
        review.progress?.groups ?? [],
        related,
      ),
    [visibleFiles, review.progress?.groups, related, kind],
  )
  const fileList = useMemo(
    () =>
      files.map((file) => {
        const state = fileState(file.path, fingerprints.get(file.path) ?? '')
        return {
          path: file.path,
          changeKind: pullFileKind(file),
          viewed: state?.viewed ?? false,
          changedSinceViewed: state?.changedSinceViewed,
          additions: file.additions ?? undefined,
          deletions: file.deletions ?? undefined,
        }
      }),
    [files, fileState, fingerprints],
  )
  const { request, connected, snapshot, connection } = useWorkspace()
  const readSubmission = useCallback(
    (submissionId: string) =>
      request('/api/scm/pulls/comment-status', { submissionId }, pullCommentStatusResponse),
    [request],
  )
  const commentsByPath = useMemo(
    () => pullCommentsByFile(detail.files, detail.comments),
    [detail.files, detail.comments],
  )
  const [split, setSplit] = useApplicationState(
      !embedded && readAppPreferences().diffLayout === 'split',
    ),
    [summaryExpanded, setSummaryExpanded] = useState(false)
  const cards = useRef(new Map<string, HTMLElement>())
  const [heights] = useState(() => new Map<string, number>())
  const draftKey = usePullStateKey(
    repositoryId,
    detail.pull.number,
    detail.pull.connectionId,
    detail.pull.url,
  )
  const [selected, setSelected] = useRetainedPullState(selectedFileCache, draftKey, '')
  const {
    drafts,
    update: updateDraft,
    error: draftError,
  } = usePullLineDrafts(draftKey, pullReviewDraftScope(connection ?? null))
  const selectFile = (path: string) => {
    setSelected(path)
    cards.current.get(path)?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  useEffect(() => {
    if (guidePath)
      cards.current.get(guidePath)?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [guidePath, files])
  const anchoredFragment = useRef('')
  useEffect(() => {
    if (!initialFragment) {
      anchoredFragment.current = ''
      return
    }
    if (!active || anchoredFragment.current === initialFragment) return
    const comment = detail.comments.find(
      (comment) =>
        comment.kind === 'inline' &&
        (comment.url.endsWith(initialFragment) || `#${comment.id}` === initialFragment),
    )
    if (!comment?.path) return
    const file = visibleFiles.find(
      (file) => file.path === comment.path || file.previousPath === comment.path,
    )
    if (file && kind && pullFileKind(file) !== kind) {
      setKind(undefined)
      return
    }
    if (file) {
      anchoredFragment.current = initialFragment
      selectFile(file.path)
    }
  }, [initialFragment, detail.comments, files, visibleFiles, kind, active])
  const selectedFile =
    files.find((file) => file.path === selected) ??
    (selected ? files.find((file) => file.previousPath === selected) : undefined) ??
    files[0]
  if (!detail.files.length && !drafts.size)
    return <p className="p-4 text-xs text-muted-foreground">No changed files returned.</p>
  return (
    <section aria-label="Code changes" className="min-w-0">
      {draftError && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {draftError}
        </p>
      )}
      {[...drafts]
        .filter(
          ([path, draft]) =>
            (draft.body || draft.suggesting || draft.submissionId) &&
            !files.some((file) => file.path === path),
        )
        .map(([path, draft]) => (
          <details key={path} className="border-b p-2 text-xs">
            <summary>Saved comment on {path}</summary>
            <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{draft.body}</pre>
            {draft.suggesting && (
              <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {draft.replacement}
              </pre>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => updateDraft(path, () => emptyPullLineDraft)}
            >
              Discard draft
            </Button>
          </details>
        ))}
      <ChangeSummary
        title={`${files.length} ${files.length === 1 ? 'file' : 'files'} · ${fileList.filter((file) => file.viewed).length} viewed`}
        files={visibleFiles}
        expanded={summaryExpanded}
        onExpandedChange={setSummaryExpanded}
        value={kind}
        onChange={setKind}
        total={hideWhitespaceChanges ? undefined : detail.pull.changedFiles}
      >
        <div className="flex max-h-80 min-h-0 flex-col overflow-hidden">
          <ReviewFiles
            showTypeFilters={false}
            showChangeBars
            files={fileList}
            groups={review.progress?.groups ?? []}
            related={related}
            onRelatedChange={setRelated}
            selected={selectedFile?.path ?? ''}
            onSelect={selectFile}
          />
        </div>
      </ChangeSummary>
      <div className="flex flex-wrap items-center justify-between gap-2 py-1">
        <OrganizeReview
          disabled={!active}
          onOpenFile={(path) => {
            setGuidePath(path)
            setKind(undefined)
            selectFile(path)
          }}
          review={review}
          onOrganized={() => setRelated(true)}
        />
        <Button
          size="sm"
          variant="outline"
          aria-pressed={split}
          onClick={() => setSplit((v) => !v)}
        >
          {split ? 'Split diff' : 'Unified diff'}
        </Button>
      </div>
      {files.length > 1 && (
        <div
          aria-label="Pinned file review controls"
          className="sticky -top-4 z-20 -mx-4 bg-background shadow-sm"
        >
          <FileReviewControls
            files={fileList}
            selected={selectedFile?.path ?? ''}
            onSelect={selectFile}
            onViewed={(viewed) => {
              if (selectedFile)
                review.setViewed(
                  selectedFile.path,
                  fingerprints.get(selectedFile.path) ?? '',
                  viewed,
                )
            }}
            disabled={
              !active ||
              !review.ready ||
              !selectedFile ||
              !fileState(selectedFile.path, fingerprints.get(selectedFile.path) ?? '')
            }
            busy={review.busy}
            error={review.error}
            onRetry={review.reload}
          />
        </div>
      )}
      {files.length <= 1 && review.error && (
        <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
          {review.error}
          <Button size="sm" variant="ghost" onClick={review.reload}>
            {uiText('Retry')}
          </Button>
        </p>
      )}
      <div className="min-w-0 space-y-4 py-2">
        {!files.length && <p className="p-4 text-xs text-muted-foreground">No matching files.</p>}
        {files.map((file) => {
          const comments = commentsByPath.get(file.path) ?? []
          const fingerprint = fingerprints.get(file.path) ?? ''
          const state = fileState(file.path, fingerprint)
          const withheld = detail.pull.provider === 'github' && githubWithheldPatch(file)
          return (
            <article
              key={file.path}
              ref={(element) => {
                if (element) cards.current.set(file.path, element)
                else cards.current.delete(file.path)
              }}
              className="scroll-mt-28 overflow-hidden rounded-xl border bg-card/30"
            >
              <div className="px-3 pb-3">
                <div className="flex flex-wrap items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">
                    {file.previousPath ? `${file.previousPath} → ` : ''}
                    {file.path}
                  </span>
                  <span className="text-xs">
                    {!withheld && file.additions !== null && (
                      <span className="text-status-success">+{file.additions}</span>
                    )}{' '}
                    {!withheld && file.deletions !== null && (
                      <span className="text-status-error">−{file.deletions}</span>
                    )}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={state?.viewed ?? false}
                      disabled={!active || !review.ready || review.busy || !state}
                      aria-label={`Viewed ${file.path}`}
                      aria-description={
                        state?.changedSinceViewed ? uiText('Changed since viewed') : undefined
                      }
                      onCheckedChange={(checked) =>
                        review.setViewed(file.path, fingerprint, checked === true)
                      }
                    />
                    {state?.changedSinceViewed ? (
                      <span className="text-status-warning">{uiText('Changed since viewed')}</span>
                    ) : (
                      'Viewed'
                    )}
                  </label>
                </div>
                <DeferredPullFile
                  file={file}
                  heights={heights}
                  pinned={selectedFile?.path === file.path || !!drafts.get(file.path)?.selection}
                >
                  {file.patchOmitted && (
                    <div className="space-y-2 py-2 text-xs">
                      <p>GitLab omitted this patch.</p>
                      {snapshot?.pullFileLoadingSupported ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!connected || !!detail.stale || !!loadingFile}
                          onClick={() => {
                            setLoadingFile(file.path)
                            setLoadError('')
                            void request(
                              '/api/scm/pulls/detail',
                              {
                                repositoryId,
                                number: detail.pull.number,
                                filePath: file.path,
                                headSha: detail.pull.headSha,
                                baseSha: detail.pull.baseSha,
                                connectionId: detail.pull.connectionId,
                                expectedDestination: detail.destination,
                              },
                              pullDetailSchema,
                            )
                              .then(
                                (result) => {
                                  const patch = result.files.find((item) => item.path === file.path)
                                  if (!patch?.patch) {
                                    setLoadError(
                                      result.warnings.join(' ') ||
                                        'GitLab did not return this patch. Open it on GitLab.',
                                    )
                                    return
                                  }
                                  setLoaded((current) => ({
                                    revision,
                                    files: [
                                      ...(current.revision === revision
                                        ? current.files.filter((item) => item.path !== file.path)
                                        : []),
                                      patch,
                                    ],
                                  }))
                                },
                                (cause: unknown) => setLoadError(String(cause)),
                              )
                              .finally(() => setLoadingFile(''))
                          }}
                        >
                          {loadingFile === file.path ? 'Loading patch…' : 'Load this patch'}
                        </Button>
                      ) : (
                        <p>Update this computer to load omitted patches.</p>
                      )}
                      {loadError && <p role="alert">{loadError}</p>}
                    </div>
                  )}
                  <PullPatch
                    key={file.path}
                    file={file}
                    draft={drafts.get(file.path)}
                    onDraft={(update) => updateDraft(file.path, update)}
                    commentDisabled={!connected || !!detail.stale || !active}
                    headSha={detail.pull.headSha}
                    baseSha={detail.pull.baseSha}
                    readSubmission={
                      snapshot?.pullCommentReceiptsSupported ? readSubmission : undefined
                    }
                    expectedDestination={detail.destination ?? detail.pull.destination}
                    split={split}
                    provider={detail.pull.provider}
                    allowAgent={!repositoryId.startsWith('http')}
                    agentAction={
                      thread
                        ? {
                            option: `“${thread.title}”`,
                            submit: `Ask in “${thread.title}”`,
                            clears: true,
                          }
                        : onAskAgent
                          ? { option: 'Agent', submit: 'Ask agent…', clears: false }
                          : undefined
                    }
                    allowInlineComment={
                      detail.capabilities?.actions.includes('inline-comment') ?? true
                    }
                    allowInlineRange={detail.capabilities?.inlineRange ?? true}
                    onComment={
                      connected && !detail.stale && active
                        ? async (body, range, destination, baseline) => {
                            const stale =
                              baseline.headSha !== detail.pull.headSha ||
                              baseline.baseSha !== detail.pull.baseSha
                            if (destination === 'github') {
                              if (stale)
                                throw new Error(
                                  'The PR changed while you were writing. Choose new lines before posting.',
                                )
                              const submissionId = snapshot?.pullCommentReceiptsSupported
                                ? randomUUID()
                                : undefined
                              if (submissionId)
                                updateDraft(
                                  file.path,
                                  (draft) => ({ ...draft, submissionId }),
                                  true,
                                )
                              await request(
                                '/api/scm/pulls/comment',
                                {
                                  repositoryId,
                                  number: detail.pull.number,
                                  headSha: baseline.headSha,
                                  baseSha: baseline.baseSha,
                                  expectedDestination: baseline.expectedDestination,
                                  connectionId: detail.pull.connectionId,
                                  path: baseline.path,
                                  body,
                                  ...range,
                                  ...(submissionId ? { submissionId } : {}),
                                },
                                pullLineCommentResponse,
                              )
                              if (submissionId)
                                updateDraft(file.path, (draft) =>
                                  draft.submissionId === submissionId ? emptyPullLineDraft : draft,
                                )
                              onPosted()
                            } else if (thread) {
                              if (stale)
                                throw new Error(
                                  'The PR changed while you were writing. Your draft is preserved. Select lines on the current revision before asking the thread.',
                                )
                              thread.onAsk(
                                buildPullReviewObjective(detail, {
                                  question: body,
                                  path: baseline.path,
                                  ...range,
                                  code: baseline.code,
                                }),
                              )
                            } else if (onAskAgent) {
                              if (stale)
                                throw new Error(
                                  'The PR changed while you were writing. Your draft is preserved. Select lines on the current revision before asking an agent.',
                                )
                              onAskAgent({
                                question: body,
                                path: baseline.path,
                                ...range,
                                code: baseline.code,
                              })
                            } else
                              onSteer(
                                `Address this feedback on ${baseline.path}:${range.start}-${range.end} (${range.side === 'additions' ? 'new' : 'old'} version), PR commit ${baseline.headSha}:\n${body}\n\nReference patch at time of comment:\n${baseline.patch.slice(0, 1500)}`,
                                baseline,
                              )
                          }
                        : undefined
                    }
                  />
                  {comments.length > 0 && (
                    <>
                      <h4 className="my-3 text-xs font-medium">
                        Feedback on this file ({comments.length})
                      </h4>
                      <PullComments
                        comments={comments}
                        fileBaseURL={
                          detail.fileBaseUrl ??
                          `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
                        }
                        actionContext={{
                          repositoryId,
                          detail,
                          onDone: onPosted,
                        }}
                      />
                    </>
                  )}
                </DeferredPullFile>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
