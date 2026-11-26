import { pullDetailSchema } from '@dovo/protocol'
import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { pullCommentsByFile } from '@dovo/protocol'
import { type ComponentRef, useEffect, useMemo, useState } from 'react'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  createDetailDrafts,
  integrationDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'

import {
  pullFileFingerprint,
  createReviewFileLookup,
  orderReviewFiles,
  pullFileKind,
  type FileKind,
} from '@dovo/protocol'
import { useFileReview } from '../../review/use-file-review'
import { MobileOrganizeReview } from '../../review/organize-review'
import { ChangeSummary } from '../../../ui/content/change-summary'
import { MobileFileTree } from '../../../ui/content/file-tree'
import { MobileFileReview } from '../../review/file-review'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from '../../../ui/content/text'
import { githubWithheldPatch, pullFilePatch, type PullDetail } from '@dovo/protocol'
import { Icon } from '../../../ui/controls/icon'
import { pullFragment } from './pull-destination'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import { DiffView } from '../../../tasks/preview/diff-view'
import { PullComments } from './pull-comments'
import type { PullActionTarget } from '../list/pull-actions'
const changeDrafts = createDetailDrafts<{
  selected: string
  related: boolean
  expanded: string[]
}>({ isClean: () => true })
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onOpen,
  onAction,
  onLineComment,
  onAskAgent,
  initialPath,
  fragment,
  onAnchor,
  viewportHeight,
}: {
  detail: PullDetail
  active?: boolean
  repositoryId: string
  onOpen: (url: string) => void
  onAction?: (target: PullActionTarget) => void
  onLineComment?: (path: string) => void
  onAskAgent?: (path: string) => void
  initialPath?: string
  fragment?: string
  onAnchor?: (node: ComponentRef<typeof View>) => void
  viewportHeight?: number
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { height } = useWindowDimensions()
  const [kind, setKind] = useState<FileKind | undefined>(undefined)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [wrapLines, setWrapLines] = useState(false)
  const [feedbackPath, setFeedbackPath] = useState('')
  const [controlsHeight, setControlsHeight] = useState(88)
  const { headSha, baseSha } = detail.pull
  const revision = JSON.stringify([repositoryId, detail.destination, headSha, baseSha])
  const [loaded, setLoaded] = useState<{ revision: string; files: PullDetail['files'] }>({
    revision,
    files: [],
  })
  const [loadingFile, setLoadingFile] = useState(false)
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
  const fingerprints = useMemo(
    () =>
      new Map(
        reviewFiles.map((file) => [file.path, pullFileFingerprint(file, { headSha, baseSha })]),
      ),
    [reviewFiles, headSha, baseSha],
  )
  const reviewVersion = useMemo(() => JSON.stringify([...fingerprints]), [fingerprints])
  const review = useFileReview(
    { kind: 'pull', repositoryId, number: detail.pull.number },
    reviewVersion,
    active,
  )
  const fileState = useMemo(() => createReviewFileLookup(review.progress), [review.progress?.files])
  const { connection, snapshot, call } = useRuntime()
  const { draft, setField } = useDetailDraft(
    changeDrafts,
    integrationDraftKey(
      connection,
      snapshot,
      repositoryId,
      undefined,
      'pull-changes',
      detail.pull.repositoryUrl,
      detail.pull.number,
    ),
    () => ({ selected: initialPath ?? detail.files[0]?.path ?? '', related: true, expanded: [] }),
  )
  const { selected, related } = draft
  const expanded = new Set(draft.expanded)
  const setRelated = (value: boolean) => setField('related', value)
  const setSelected = (value: string) => setField('selected', value)
  useEffect(() => {
    if (initialPath) {
      setSelected(initialPath)
      setKind(undefined)
    }
  }, [initialPath, fragment])
  const allFiles = useMemo(
    () =>
      orderReviewFiles(
        reviewFiles.map((file) => {
          const state = fileState(file.path, fingerprints.get(file.path) ?? '')
          return {
            ...file,
            viewed: state?.viewed ?? false,
            changedSinceViewed: state?.changedSinceViewed,
          }
        }),
        review.progress?.groups ?? [],
        related,
      ),
    [reviewFiles, review.progress, fingerprints, related, fileState],
  )
  const files = allFiles.filter((file) => !kind || pullFileKind(file) === kind)
  const file =
    files.find((file) => file.path === selected || file.previousPath === selected) ?? files[0]
  const commentsByFile = useMemo(
    () => pullCommentsByFile(detail.files, detail.comments),
    [detail.files, detail.comments],
  )
  const comments = (file && commentsByFile.get(file.path)) ?? []
  const linkedComment = fragment
    ? comments.find((comment) => pullFragment(comment.url) === fragment)
    : undefined
  useEffect(() => {
    if (linkedComment && file) setFeedbackPath(file.path)
  }, [linkedComment?.id, fragment, file?.path])
  const summary = (
    <ChangeSummary
      files={detail.files}
      value={kind}
      onChange={setKind}
      total={detail.pull.changedFiles}
      expanded={summaryExpanded}
      onExpandedChange={setSummaryExpanded}
    >
      <MobileFileTree
        files={files.map((item) => ({
          path: item.path,
          changeKind: pullFileKind(item),
          viewed: item.viewed,
          changedSinceViewed: item.changedSinceViewed,
          additions: item.additions ?? undefined,
          deletions: item.deletions ?? undefined,
        }))}
        groups={review.progress?.groups ?? []}
        related={related}
        selected={file?.path}
        onSelect={setSelected}
        scrollable={false}
        defaultExpandedDepth={0}
        showChangeBars
      />
    </ChangeSummary>
  )
  if (!file)
    return (
      <View>
        {summary}
        <Text style={styles.muted}>
          {detail.files.length
            ? uiText('No matching files.')
            : uiText('No changed files returned.')}
        </Text>
      </View>
    )
  const reason = file.attributes?.generated
    ? 'Generated file'
    : file.attributes?.vendored
      ? 'Vendored file'
      : ''
  const collapsed = !!reason && !expanded.has(file.path)
  const feedbackOpen = feedbackPath === file.path
  const canComment =
    !!onLineComment &&
    !file.attributes?.binary &&
    !collapsed &&
    !!file.patch &&
    !!detail.capabilities?.actions.includes('inline-comment')
  // The parent measures its viewport after the navigation and primary-action bars.
  const codeHeight = Math.max(
    200,
    (viewportHeight ?? height * 0.75) -
      controlsHeight -
      (comments.length || canComment ? 44 : 0) -
      24,
  )
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <View style={{ paddingHorizontal: 12 }}>{summary}</View>
      <View
        testID="PR file controls"
        onLayout={({ nativeEvent }) => setControlsHeight(nativeEvent.layout.height)}
        style={{ gap: 4 }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <MobileFileReview
            files={files.map((file) => {
              const withheld = detail.pull.provider === 'github' && githubWithheldPatch(file)
              return {
                path: file.path,
                changeKind: pullFileKind(file),
                viewed: file.viewed,
                changedSinceViewed: file.changedSinceViewed,
                additions: withheld ? undefined : (file.additions ?? undefined),
                deletions: withheld ? undefined : (file.deletions ?? undefined),
              }
            })}
            groups={review.progress?.groups ?? []}
            related={related}
            onRelatedChange={setRelated}
            selected={file.path}
            wrapLines={wrapLines}
            onWrapLinesChange={setWrapLines}
            onSelect={setSelected}
            onViewed={(viewed) =>
              review.setViewed(file.path, fingerprints.get(file.path) ?? '', viewed)
            }
            disabled={
              !active || !review.ready || !fileState(file.path, fingerprints.get(file.path) ?? '')
            }
            busy={review.busy}
            error={review.error}
            onRetry={review.reload}
          />
        </View>
        {file.previousPath && (
          <Text selectable style={[styles.muted, { paddingHorizontal: 12 }]}>
            <InterfaceText values={{ value0: file.previousPath }}>
              {'Renamed from {value0}'}
            </InterfaceText>
          </Text>
        )}
        {reason && !file.attributes?.binary && (
          <>
            <Text style={styles.muted}>
              <InterfaceText values={{ value0: reason }}>
                {'{value0} · marked in .gitattributes'}
              </InterfaceText>
            </Text>
            <Action
              secondary
              label={collapsed ? uiText('Show changes') : uiText('Hide changes')}
              onPress={() =>
                (() => {
                  const next = new Set(expanded)
                  if (collapsed) next.add(file.path)
                  else next.delete(file.path)
                  setField('expanded', [...next])
                })()
              }
            />
          </>
        )}
      </View>
      {file.attributes?.binary ? (
        <Text style={styles.muted}>
          <InterfaceText>{'Text diff disabled by .gitattributes (binary or -diff).'}</InterfaceText>
        </Text>
      ) : collapsed ? null : file.patch ? (
        <View
          testID="PR code viewport"
          style={{
            height: codeHeight,
          }}
        >
          <DiffView
            key={file.path}
            patch={pullFilePatch(file)}
            wrapLines={wrapLines}
            path={file.path}
            previousPath={file.previousPath}
          />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={styles.muted}>
            {detail.pull.provider === 'github' && githubWithheldPatch(file)
              ? uiText(
                  'GitHub withheld this file’s patch. Open the PR on GitHub for the full file.',
                )
              : uiText('No text patch available. Open this PR on its server.')}
          </Text>
          {file.patchOmitted &&
            (snapshot?.pullFileLoadingSupported ? (
              <Action
                label={loadingFile ? uiText('Loading patch…') : uiText('Load this patch')}
                disabled={loadingFile || !!detail.stale}
                onPress={() => {
                  setLoadingFile(true)
                  setLoadError('')
                  void call(
                    '/api/scm/pulls/detail',
                    {
                      repositoryId,
                      number: detail.pull.number,
                      filePath: file.path,
                      headSha,
                      baseSha,
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
                    .finally(() => setLoadingFile(false))
                }}
              />
            ) : (
              <Text style={styles.muted}>
                {uiText('Update this computer to load omitted patches.')}
              </Text>
            ))}
          {!!loadError && <Text style={styles.error}>{loadError}</Text>}
        </View>
      )}
      {onAskAgent && (
        <Action
          secondary
          label={uiText('Ask agent about this file')}
          onPress={() => onAskAgent(file.path)}
        />
      )}
      {(!!comments.length || canComment) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            minHeight: 44,
          }}
        >
          {!!comments.length && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText('Feedback on this file ({value0})', {
                value0: comments.length,
              })}
              accessibilityState={{ expanded: feedbackOpen }}
              onPress={() => setFeedbackPath(feedbackOpen ? '' : file.path)}
              style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Icon name={feedbackOpen ? 'down' : 'next'} size={14} color={colors.muted} />
              <Text style={styles.muted}>
                <InterfaceText values={{ value0: comments.length }}>
                  {'Feedback ({value0})'}
                </InterfaceText>
              </Text>
            </Pressable>
          )}
          {canComment && (
            <Action
              secondary
              label={uiText('Comment on line')}
              icon="chat"
              onPress={() => onLineComment?.(file.path)}
            />
          )}
        </View>
      )}
      {feedbackOpen && (
        <View style={{ paddingHorizontal: 12 }}>
          <PullComments
            comments={comments}
            onOpen={onOpen}
            fragment={fragment}
            onAnchor={onAnchor}
            onAction={onAction}
            capabilities={detail.capabilities}
            fileBaseURL={detail.fileBaseUrl}
          />
        </View>
      )}
      <View style={{ paddingHorizontal: 12 }}>
        <MobileOrganizeReview
          onOpenFile={(path) => {
            setKind(undefined)
            setSelected(path)
          }}
          review={review}
          onOrganized={() => setRelated(true)}
        />
      </View>
    </View>
  )
}
