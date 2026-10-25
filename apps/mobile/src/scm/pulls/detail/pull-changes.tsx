import { type ComponentRef, useEffect, useMemo, useState } from 'react'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  createDetailDrafts,
  integrationDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'

import {
  pullFileFingerprint,
  reviewFileState,
  orderReviewFiles,
  pullFileKind,
  type FileKind,
} from '@dovo/protocol'
import { useFileReview } from '../../review/use-file-review'
import { MobileOrganizeReview } from '../../review/organize-review'
import { ChangeTypeFilters } from '../../../ui/content/change-types'
import { MobileFileReview } from '../../review/file-review'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from '../../../ui/content/text'
import { pullFilePatch, type PullDetail } from '@dovo/protocol'
import { Sheet } from '../../../ui/layout/sheet'
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
}>()
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onOpen,
  onAction,
  onLineComment,
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
  initialPath?: string
  fragment?: string
  onAnchor?: (node: ComponentRef<typeof View>) => void
  viewportHeight?: number
}) {
  const { colors, styles } = useTheme()

  const { height } = useWindowDimensions()
  const [kind, setKind] = useState<FileKind | undefined>(undefined)
  const [wrapLines, setWrapLines] = useState(false)
  const [options, setOptions] = useState(false)
  const [feedbackPath, setFeedbackPath] = useState('')
  const [controlsHeight, setControlsHeight] = useState(88)
  const { headSha, baseSha } = detail.pull
  const fingerprints = useMemo(
    () =>
      new Map(
        detail.files.map((file) => [file.path, pullFileFingerprint(file, { headSha, baseSha })]),
      ),
    [detail.files, headSha, baseSha],
  )
  const review = useFileReview(
    { kind: 'pull', repositoryId, number: detail.pull.number },
    JSON.stringify([...fingerprints]),
    active,
  )
  const { connection, snapshot } = useRuntime()
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
        detail.files.map((file) => ({
          ...file,
          viewed:
            reviewFileState(review.progress, file.path, fingerprints.get(file.path) ?? '')
              ?.viewed ?? false,
        })),
        review.progress?.groups ?? [],
        related,
      ),
    [detail.files, review.progress, fingerprints, related],
  )
  const files = allFiles.filter((file) => !kind || pullFileKind(file) === kind)
  const file =
    files.find((file) => file.path === selected || file.previousPath === selected) ?? files[0]
  const comments = detail.comments.filter(
    (comment) =>
      comment.kind === 'inline' &&
      (comment.path === file?.path || comment.path === file?.previousPath),
  )
  const linkedComment = fragment
    ? comments.find((comment) => pullFragment(comment.url) === fragment)
    : undefined
  useEffect(() => {
    if (linkedComment && file) setFeedbackPath(file.path)
  }, [linkedComment?.id, fragment, file?.path])
  const filters = (
    <ChangeTypeFilters
      files={detail.files}
      value={kind}
      onChange={setKind}
      total={detail.pull.changedFiles}
    />
  )
  if (!file)
    return (
      <View>
        {filters}
        <Text style={styles.muted}>
          {detail.files.length ? 'No matching files.' : 'No changed files returned.'}
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
      <View
        testID="PR file controls"
        onLayout={({ nativeEvent }) => setControlsHeight(nativeEvent.layout.height)}
        style={{ gap: 4 }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          {filters}
          <MobileFileReview
            files={files.map((file) => ({
              path: file.path,
              changeKind: pullFileKind(file),
              viewed: file.viewed,
              additions: file.additions ?? undefined,
              deletions: file.deletions ?? undefined,
            }))}
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
              !review.ready ||
              !reviewFileState(review.progress, file.path, fingerprints.get(file.path) ?? '')
            }
            busy={review.busy}
            error={review.error}
            onRetry={review.reload}
            onOptions={() => setOptions(true)}
          />
        </View>
        {file.previousPath && (
          <Text selectable style={[styles.muted, { paddingHorizontal: 12 }]}>
            Renamed from {file.previousPath}
          </Text>
        )}
        {reason && !file.attributes?.binary && (
          <>
            <Text style={styles.muted}>{reason} · marked in .gitattributes</Text>
            <Action
              secondary
              label={collapsed ? 'Show changes' : 'Hide changes'}
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
        <Text style={styles.muted}>Text diff disabled by .gitattributes (binary or -diff).</Text>
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
        <Text style={styles.muted}>No text patch available. Open this PR on its server.</Text>
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
              accessibilityLabel={`Feedback on this file (${comments.length})`}
              accessibilityState={{ expanded: feedbackOpen }}
              onPress={() => setFeedbackPath(feedbackOpen ? '' : file.path)}
              style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Icon name={feedbackOpen ? 'down' : 'next'} size={14} color={colors.muted} />
              <Text style={styles.muted}>Feedback ({comments.length})</Text>
            </Pressable>
          )}
          {canComment && (
            <Action
              secondary
              label="Comment on line"
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
      {options && (
        <Sheet title="File actions" presentation="dialog" onClose={() => setOptions(false)}>
          <MobileOrganizeReview review={review} onOrganized={() => setRelated(true)} />
        </Sheet>
      )}
    </View>
  )
}
