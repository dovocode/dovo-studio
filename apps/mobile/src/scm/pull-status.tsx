import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import {
  checkSignal,
  latestPullReviews,
  pullCommentSignal,
  pullMergeability,
  type PullComment,
  type PullDetail,
  type PullSignal,
} from '@dovo/protocol'
import { Icon, type IconName } from '../ui/icon'
import { colors, styles } from '../ui/theme'
import { Markdown } from '../ui/markdown'
export function pullSignalColor(signal: PullSignal) {
  return signal.tone === 'danger'
    ? colors.error
    : signal.tone === 'positive'
      ? '#8ad5b0'
      : signal.tone === 'warning'
        ? '#e7c681'
        : signal.tone === 'accent'
          ? '#c8b0f7'
          : colors.muted
}
export function Signal({ signal, emphasis = false }: { signal: PullSignal; emphasis?: boolean }) {
  return (
    <Text
      style={[
        styles.muted,
        { color: pullSignalColor(signal), flexShrink: 1, fontWeight: emphasis ? '600' : '400' },
      ]}
    >
      {signal.label}
    </Text>
  )
}
export function PullCommentLabel({ comment }: { comment: PullComment }) {
  const signal = pullCommentSignal(comment)
  const color = pullSignalColor(signal)
  const icon: IconName =
    comment.kind === 'inline'
      ? 'changes'
      : comment.kind !== 'review'
        ? 'chat'
        : comment.state === 'APPROVED'
          ? 'check'
          : comment.state === 'CHANGES_REQUESTED'
            ? 'changes'
            : comment.state === 'DISMISSED'
              ? 'close'
              : 'chat'
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 }}
    >
      <Icon name={icon} color={color} size={14} />
      <Text style={[styles.muted, { color, fontWeight: '600', flexShrink: 1 }]}>
        {signal.label}
      </Text>
    </View>
  )
}
export function PullStatus({
  detail,
  onOpen,
}: {
  detail: PullDetail
  onOpen: (url: string) => void
}) {
  const reviews = latestPullReviews(detail.comments)
  const checks = [...detail.checks].sort((a, b) => {
    const priority = (status: string) =>
      ({ danger: 0, warning: 1, positive: 2, neutral: 3, accent: 3 })[checkSignal(status).tone]
    return priority(a.status) - priority(b.status)
  })
  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 4 }}>
        <Text
          accessibilityRole="header"
          style={[styles.muted, { fontWeight: '600', marginBottom: 4 }]}
        >
          Checks · {checks.length}
        </Text>
        {!checks.length && (
          <Text style={styles.muted}>No checks returned. See any loading warnings above.</Text>
        )}
        {checks.map((check, index) => (
          <View key={`${check.name}-${index}`} style={{ gap: 8 }}>
            <Pressable
              testID={`Open ${check.name}`}
              accessibilityRole={check.url ? 'link' : 'text'}
              accessibilityLabel={`${check.name}, ${checkSignal(check.status).label}${check.url ? '. Open on server' : ''}`}
              disabled={!check.url}
              onPress={() => check.url && onOpen(check.url)}
              style={({ pressed }) => [
                styles.row,
                {
                  flexWrap: 'nowrap',
                  minHeight: 52,
                  paddingVertical: 10,
                  borderBottomWidth: 0.5,
                  borderColor: colors.border,
                  opacity: pressed ? 0.55 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[styles.text, { fontSize: 15 }]}>{check.name}</Text>
                <Signal signal={checkSignal(check.status)} />
              </View>
              {check.url && <Icon name="next" size={13} color={colors.muted} />}
            </Pressable>
            {!!check.summary && <Markdown text={check.summary} baseURL={check.url} />}
            {!!check.details && <Markdown text={check.details} baseURL={check.url} />}
            {check.annotations?.map((annotation, annotationIndex) => (
              <View key={annotationIndex} style={{ gap: 4, paddingBottom: 8 }}>
                <Text style={styles.muted}>
                  {annotation.path}:{annotation.startLine} · {annotation.level}
                </Text>
                <Text selectable style={styles.text}>
                  {annotation.message}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <View style={{ gap: 4 }}>
        <Text
          accessibilityRole="header"
          style={[styles.muted, { fontWeight: '600', marginBottom: 4 }]}
        >
          Review decisions
        </Text>
        {reviews.length ? (
          reviews.map((review) => (
            <Pressable
              key={review.author}
              accessibilityRole="link"
              accessibilityLabel={`${review.author}: ${pullCommentSignal(review).label}. Open review on server`}
              onPress={() => onOpen(review.url)}
              style={({ pressed }) => [
                styles.row,
                {
                  minHeight: 52,
                  paddingVertical: 10,
                  borderBottomWidth: 0.5,
                  borderColor: colors.border,
                  flexWrap: 'nowrap',
                  opacity: pressed ? 0.55 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={[styles.text, { fontSize: 15 }]}>{review.author}</Text>
                <PullCommentLabel comment={review} />
                {!!review.commitId && (
                  <Text selectable style={styles.muted}>
                    Reviewed {review.commitId.slice(0, 8)}
                  </Text>
                )}
              </View>
              <Icon name="next" size={13} color={colors.muted} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.muted}>No review decision yet.</Text>
        )}
        {!!detail.pull.reviewers.length && (
          <Text style={[styles.muted, { marginTop: 8 }]}>
            Requested: {detail.pull.reviewers.join(', ')}
          </Text>
        )}
        <Signal signal={pullMergeability(detail.pull)} />
      </View>
    </View>
  )
}
