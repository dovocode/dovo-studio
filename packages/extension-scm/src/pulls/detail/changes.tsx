import { pullFileFingerprint, reviewFileState, orderReviewFiles } from '@dovo/protocol'
import { useFileReview } from '@dovo/studio-core'
import { OrganizeReview, FileReviewControls, ReviewFiles } from '@dovo/studio-ui'
import { useMemo, useRef, useState } from 'react'
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
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onSteer,
  onPosted,
  embedded = false,
}: {
  embedded?: boolean
  detail: PullDetail
  active?: boolean
  repositoryId: string
  onSteer: (objective: string) => void
  onPosted: () => void
}) {
  const { hideWhitespaceChanges } = useAppPreferences()
  const visibleFiles = useMemo(
    () => detail.files.filter((file) => !hideWhitespaceChanges || !whitespaceOnlyPatch(file)),
    [detail.files, hideWhitespaceChanges],
  )
  const fingerprints = useMemo(
    () => new Map(visibleFiles.map((file) => [file.path, pullFileFingerprint(file, detail.pull)])),
    [visibleFiles, detail.pull],
  )
  const review = useFileReview(
    { kind: 'pull', repositoryId, number: detail.pull.number },
    JSON.stringify([...fingerprints]),
    active,
  )
  const [related, setRelated] = useApplicationState(true)
  const files = useMemo(
    () => orderReviewFiles(visibleFiles, review.progress?.groups ?? [], related),
    [visibleFiles, review.progress?.groups, related],
  )
  const viewed = useMemo(
    () =>
      new Set(
        files
          .filter(
            (file) =>
              reviewFileState(review.progress, file.path, fingerprints.get(file.path) ?? '')
                ?.viewed,
          )
          .map((file) => file.path),
      ),
    [files, fingerprints, review.progress],
  )
  const { request, connected } = useWorkspace()
  const commentsByPath = useMemo(() => {
    const byPath = new Map<string, PullDetail['comments']>()
    for (const comment of detail.comments) {
      if (comment.kind !== 'inline' || !comment.path) continue
      const comments = byPath.get(comment.path) ?? []
      comments.push(comment)
      byPath.set(comment.path, comments)
    }
    return byPath
  }, [detail.comments])
  const [selected, setSelected] = useApplicationState(files[0]?.path ?? ''),
    [split, setSplit] = useApplicationState(
      !embedded && readAppPreferences().diffLayout === 'split',
    ),
    [treeOpen, setTreeOpen] = useApplicationState(true)
  const cards = useRef(new Map<string, HTMLElement>())
  const [heights] = useState(() => new Map<string, number>())
  // Comment ranges and destinations live here, before any file leaves the render window.
  const [drafts, setDrafts] = useApplicationState<ReadonlyMap<string, PullLineDraft>>(new Map())
  const updateDraft = (path: string, update: (draft: PullLineDraft) => PullLineDraft) =>
    setDrafts((current) =>
      new Map(current).set(path, update(current.get(path) ?? emptyPullLineDraft)),
    )
  const selectFile = (path: string) => {
    setSelected(path)
    cards.current.get(path)?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const selectedFile = files.find((file) => file.path === selected) ?? files[0]
  if (!files.length)
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
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen((v) => !v)}
        >
          {treeOpen ? 'Hide files' : 'Show files'}
        </Button>
      </div>
      <OrganizeReview review={review} onOrganized={() => setRelated(true)} />
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
            !reviewFileState(
              review.progress,
              selectedFile.path,
              fingerprints.get(selectedFile.path) ?? '',
            )
          }
          busy={review.busy}
          error={review.error}
          onRetry={review.reload}
        />
      </div>
      <div className="flex min-w-0 flex-col-reverse gap-3 @4xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4 py-3">
          {files.map((file) => {
            const comments = file.previousPath
              ? detail.comments.filter(
                  (comment) =>
                    comment.kind === 'inline' &&
                    (comment.path === file.path || comment.path === file.previousPath),
                )
              : (commentsByPath.get(file.path) ?? [])
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
                        <span className="text-green-400">+{file.additions}</span>
                      )}{' '}
                      {file.deletions !== null && (
                        <span className="text-red-400">−{file.deletions}</span>
                      )}
                    </span>
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox
                        checked={viewed.has(file.path)}
                        disabled={
                          !review.ready ||
                          review.busy ||
                          !reviewFileState(
                            review.progress,
                            file.path,
                            fingerprints.get(file.path) ?? '',
                          )
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
                      headSha={detail.pull.headSha}
                      split={split}
                      provider={detail.pull.provider}
                      allowInlineComment={
                        detail.capabilities?.actions.includes('inline-comment') ?? true
                      }
                      allowInlineRange={detail.capabilities?.inlineRange ?? true}
                      onComment={
                        connected
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
        {treeOpen && (
          <aside className="flex max-h-[65vh] min-h-0 shrink-0 flex-col overflow-hidden border-b p-2 @4xl:sticky @4xl:top-2 @4xl:w-64 @4xl:self-start @4xl:border-b-0 @4xl:border-l">
            <ReviewFiles
              files={files.map((file) => ({
                path: file.path,
                viewed: viewed.has(file.path),
                additions: file.additions ?? 0,
                deletions: file.deletions ?? 0,
              }))}
              groups={review.progress?.groups ?? []}
              related={related}
              onRelatedChange={setRelated}
              selected={selectedFile?.path ?? ''}
              onSelect={selectFile}
            />
          </aside>
        )}
      </div>
    </section>
  )
}
