import { pullCommentsByFile } from '@dovo/protocol'
import {
  pullFileFingerprint,
  createReviewFileLookup,
  orderReviewFiles,
  pullFileKind,
  type FileKind,
} from '@dovo/protocol'
import { useFileReview } from '@dovo/studio-core'
import { ChangeSummary, OrganizeReview, FileReviewControls, ReviewFiles } from '@dovo/studio-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppPreferences, whitespaceOnlyPatch } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useWorkspace,
  pullLineCommentResponse,
  type PullDetail,
  readAppPreferences,
} from '@dovo/studio-core'
import { Button, Checkbox } from '@dovo/studio-ui'
import { PullPatch, emptyPullLineDraft, type PullLineDraft } from './patch'
import { DeferredPullFile } from './deferred-file'
import { PullComments } from './comments'
import { createPullStateCache, useRetainedPullState, usePullStateKey } from '../retained-state'
const lineDraftCache = createPullStateCache<ReadonlyMap<string, PullLineDraft>>(30)
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onSteer,
  onPosted,
  embedded = false,
  initialFragment = '',
}: {
  embedded?: boolean
  initialFragment?: string
  detail: PullDetail
  active?: boolean
  repositoryId: string
  onSteer: (objective: string, baseline?: { headSha: string; expectedDestination?: string }) => void
  onPosted: () => void
}) {
  const { hideWhitespaceChanges } = useAppPreferences()
  const [guidePath, setGuidePath] = useState('')
  const visibleFiles = useMemo(
    () =>
      detail.files.filter(
        (file) => file.path === guidePath || !hideWhitespaceChanges || !whitespaceOnlyPatch(file),
      ),
    [detail.files, hideWhitespaceChanges, guidePath],
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
  const viewed = useMemo(
    () =>
      new Set(
        files
          .filter((file) => fileState(file.path, fingerprints.get(file.path) ?? '')?.viewed)
          .map((file) => file.path),
      ),
    [files, fingerprints, fileState],
  )
  const { request, connected } = useWorkspace()
  const commentsByPath = useMemo(
    () => pullCommentsByFile(detail.files, detail.comments),
    [detail.files, detail.comments],
  )
  const [selected, setSelected] = useApplicationState(files[0]?.path ?? ''),
    [split, setSplit] = useApplicationState(
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
  // Full drafts outlive disconnects, detail navigation, and the render window.
  const [drafts, setDrafts] = useRetainedPullState(lineDraftCache, draftKey, new Map())
  const updateDraft = (path: string, update: (draft: PullLineDraft) => PullLineDraft) =>
    setDrafts((current) => {
      const next = new Map(current)
      const draft = update(current.get(path) ?? emptyPullLineDraft)
      next.delete(path)
      if (draft.selection) next.set(path, draft)
      while (next.size > 20) {
        const oldest = next.keys().next().value
        if (oldest === undefined) break
        next.delete(oldest)
      }
      return next
    })
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
    const file = visibleFiles.find(
      (file) => file.path === comment?.path || file.previousPath === comment?.path,
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
  const selectedFile = files.find((file) => file.path === selected) ?? files[0]
  if (!detail.files.length)
    return <p className="p-4 text-xs text-muted-foreground">No changed files returned.</p>
  return (
    <section aria-label="Code changes" className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-y py-2 text-xs">
        <h3 className="mr-auto font-medium">
          {files.filter((file) => viewed.has(file.path)).length} of {files.length} viewed
        </h3>
        <Button size="sm" variant="outline" onClick={() => setSplit((v) => !v)}>
          {split ? 'Split diff' : 'Unified diff'}
        </Button>
      </div>
      <ChangeSummary
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
            files={files.map((file) => ({
              path: file.path,
              changeKind: pullFileKind(file),
              viewed: viewed.has(file.path),
              additions: file.additions ?? undefined,
              deletions: file.deletions ?? undefined,
            }))}
            groups={review.progress?.groups ?? []}
            related={related}
            onRelatedChange={setRelated}
            selected={selectedFile?.path ?? ''}
            onSelect={selectFile}
          />
        </div>
      </ChangeSummary>
      <OrganizeReview
        onOpenFile={(path) => {
          setGuidePath(path)
          setKind(undefined)
          selectFile(path)
        }}
        review={review}
        onOrganized={() => setRelated(true)}
      />
      <div
        aria-label="Pinned file review controls"
        className="sticky -top-4 z-20 -mx-4 bg-background shadow-sm"
      >
        <FileReviewControls
          files={files.map((file) => ({ path: file.path, viewed: viewed.has(file.path) }))}
          selected={selectedFile?.path ?? ''}
          onSelect={selectFile}
          onViewed={(viewed) => {
            if (selectedFile)
              review.setViewed(selectedFile.path, fingerprints.get(selectedFile.path) ?? '', viewed)
          }}
          disabled={
            !review.ready ||
            !selectedFile ||
            !fileState(selectedFile.path, fingerprints.get(selectedFile.path) ?? '')
          }
          busy={review.busy}
          error={review.error}
          onRetry={review.reload}
        />
      </div>
      <div className="min-w-0 space-y-4 py-3">
        {!files.length && <p className="p-4 text-xs text-muted-foreground">No matching files.</p>}
        {files.map((file) => {
          const comments = commentsByPath.get(file.path) ?? []
          return (
            <article
              key={file.path}
              ref={(element) => {
                if (element) cards.current.set(file.path, element)
                else cards.current.delete(file.path)
              }}
              className="scroll-mt-28 overflow-hidden rounded-xl border bg-card/30"
            >
              <div className="px-3">
                <div className="flex flex-wrap items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">
                    {file.previousPath ? `${file.previousPath} → ` : ''}
                    {file.path}
                  </span>
                  <span className="text-xs">
                    {file.additions !== null && (
                      <span className="text-status-success">+{file.additions}</span>
                    )}{' '}
                    {file.deletions !== null && (
                      <span className="text-status-error">−{file.deletions}</span>
                    )}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={viewed.has(file.path)}
                      disabled={
                        !review.ready ||
                        review.busy ||
                        !fileState(file.path, fingerprints.get(file.path) ?? '')
                      }
                      aria-label={`Viewed ${file.path}`}
                      onCheckedChange={(checked) =>
                        review.setViewed(
                          file.path,
                          fingerprints.get(file.path) ?? '',
                          checked === true,
                        )
                      }
                    />
                    Viewed
                  </label>
                </div>
                <DeferredPullFile
                  file={file}
                  heights={heights}
                  pinned={selected === file.path || !!drafts.get(file.path)?.selection}
                >
                  <PullPatch
                    key={file.path}
                    file={file}
                    draft={drafts.get(file.path)}
                    onDraft={(update) => updateDraft(file.path, update)}
                    commentDisabled={!connected || !!detail.stale || !active}
                    headSha={detail.pull.headSha}
                    expectedDestination={detail.destination ?? detail.pull.destination}
                    split={split}
                    provider={detail.pull.provider}
                    allowAgent={!repositoryId.startsWith('http')}
                    allowInlineComment={
                      detail.capabilities?.actions.includes('inline-comment') ?? true
                    }
                    allowInlineRange={detail.capabilities?.inlineRange ?? true}
                    onComment={
                      connected && !detail.stale && active
                        ? async (body, range, destination, baseline) => {
                            if (destination === 'github') {
                              if (baseline.headSha !== detail.pull.headSha)
                                throw new Error(
                                  'The PR changed while you were writing. Your draft is preserved. Copy it, cancel, and select lines on the current revision before posting.',
                                )
                              await request(
                                '/api/scm/pulls/comment',
                                {
                                  repositoryId,
                                  number: detail.pull.number,
                                  headSha: baseline.headSha,
                                  expectedDestination: baseline.expectedDestination,
                                  connectionId: detail.pull.connectionId,
                                  path: baseline.path,
                                  body,
                                  ...range,
                                },
                                pullLineCommentResponse,
                              )
                              onPosted()
                            } else
                              onSteer(
                                `Address this feedback on ${baseline.path}:${range.start}-${range.end} (${range.side === 'additions' ? 'new' : 'old'} version), PR commit ${baseline.headSha}:\n${body}\n\nReference patch at time of comment:\n${baseline.patch.slice(0, 1500)}`,
                                baseline,
                              )
                          }
                        : undefined
                    }
                  />
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
                </DeferredPullFile>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
