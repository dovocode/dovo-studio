import { useMemo } from 'react'
import { pullFileFingerprint, reviewFileState, orderReviewFiles } from '@dovo/protocol'
import { useFileReview } from '../../review/use-file-review'
import { MobileFileReview } from '../../review/file-review'
import { useApplicationState } from '../../../runtime/state/application-state'
import { View, useWindowDimensions } from 'react-native'
import { Text } from '../../../ui/content/text'
import { pullFilePatch, type PullDetail } from '@dovo/protocol'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import { DiffView } from '../../../tasks/preview/diff-view'
import { PullComments } from './pull-comments'
import type { PullActionTarget } from '../list/pull-actions'
export function PullChanges({
  detail,
  active = true,
  repositoryId,
  onOpen,
  onAction,
  onLineComment,
}: {
  detail: PullDetail
  active?: boolean
  repositoryId: string
  onOpen: (url: string) => void
  onAction?: (target: PullActionTarget) => void
  onLineComment?: (path: string) => void
}) {
  const { colors, styles } = useTheme()

  const { height } = useWindowDimensions()
  const fingerprints = useMemo(
    () => new Map(detail.files.map((file) => [file.path, pullFileFingerprint(file, detail.pull)])),
    [detail.files, detail.pull],
  )
  const review = useFileReview(
    { kind: 'pull', repositoryId, number: detail.pull.number },
    JSON.stringify([...fingerprints]),
    active,
  )
  const [related, setRelated] = useApplicationState(true)
  const files = useMemo(
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
  const [selected, setSelected] = useApplicationState(detail.files[0]?.path ?? '')
  const file = files.find((file) => file.path === selected) ?? files[0]
  if (!file) return <Text style={styles.muted}>No changed files returned.</Text>
  return (
    <View
      style={{
        gap: 10,
      }}
    >
      <MobileFileReview
        files={files.map((file) => ({
          path: file.path,
          viewed: file.viewed,
          label: `+${file.additions ?? 0} −${file.deletions ?? 0}`,
        }))}
        groups={review.progress?.groups ?? []}
        related={related}
        onRelatedChange={setRelated}
        selected={file.path}
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
      />
      <Text selectable style={styles.muted}>
        {file.previousPath ? `Renamed from ${file.previousPath} · ` : ''}
        <Text
          style={{
            color: colors.success,
          }}
        >
          {file.additions === null ? '' : `+${file.additions}`}
        </Text>{' '}
        <Text
          style={{
            color: colors.error,
          }}
        >
          {file.deletions === null ? '' : `−${file.deletions}`}
        </Text>
      </Text>
      {file.patch ? (
        <View
          style={{
            height: Math.max(280, Math.min(600, height * 0.55)),
          }}
        >
          <DiffView key={file.path} patch={pullFilePatch(file)} />
        </View>
      ) : (
        <Text style={styles.muted}>No text patch available. Open this PR on its server.</Text>
      )}
      <Text
        accessibilityRole="header"
        style={[
          styles.muted,
          {
            fontWeight: '600',
            marginTop: 6,
          },
        ]}
      >
        Feedback on this file
      </Text>
      {onLineComment && file.patch && detail.capabilities?.actions.includes('inline-comment') && (
        <Action secondary label="Comment on line" onPress={() => onLineComment(file.path)} />
      )}
      <PullComments
        comments={detail.comments.filter(
          (c) => c.kind === 'inline' && (c.path === file.path || c.path === file.previousPath),
        )}
        onOpen={onOpen}
        onAction={onAction}
        capabilities={detail.capabilities}
        fileBaseURL={detail.fileBaseUrl}
      />
    </View>
  )
}
