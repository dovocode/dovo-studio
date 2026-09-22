import { Markdown } from '../ui/markdown'
import { Platform, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { pullCommentSignal, type PullComment, type ForgeCapabilities } from '@dovo/protocol'
import type { PullActionTarget } from './pull-actions'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'
import { PullCommentLabel } from './pull-status'
export function PullComments({
  comments,
  onOpen,
  fileBaseURL,
  onAction,
  capabilities,
}: {
  comments: PullComment[]
  onOpen: (url: string) => void
  fileBaseURL?: string
  onAction?: (target: PullActionTarget) => void
  capabilities?: ForgeCapabilities
}) {
  return (
    <View style={{ gap: 12, minWidth: 0 }}>
      {!comments.length && <Text style={styles.muted}>No discussion yet.</Text>}
      {comments.map((c) => (
        <View
          key={c.id}
          style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: colors.border }}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`View ${c.author}'s ${pullCommentSignal(c).label} on server`}
            onPress={() => onOpen(c.url)}
            style={({ pressed }) => [
              styles.row,
              { minHeight: 44, flexWrap: 'nowrap', opacity: pressed ? 0.55 : 1 },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={[styles.row, { columnGap: 10, rowGap: 4 }]}>
                <Text style={[styles.text, { fontWeight: '600', fontSize: 15, flexShrink: 1 }]}>
                  {c.author}
                </Text>
                <PullCommentLabel comment={c} />
              </View>
              <Text style={styles.muted}>
                {c.date
                  ? new Date(c.date).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Not submitted yet'}
                {c.kind === 'review' && c.commitId ? ` · Reviewed ${c.commitId.slice(0, 8)}` : ''}
              </Text>
            </View>
            <Icon name="next" size={13} color={colors.muted} />
          </Pressable>
          {!!c.path && (
            <Text
              selectable
              style={[
                styles.muted,
                { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
              ]}
            >
              {c.path}
              {c.line ? ` · Line ${c.line}` : ' · Previous revision'}
            </Text>
          )}
          {!!c.body.trim() && (
            <Markdown text={c.body} baseURL={c.url} fileBaseURL={fileBaseURL} preserveLineBreaks />
          )}
          {c.resolved !== undefined && (
            <Text style={styles.muted}>
              {c.resolved ? 'Resolved discussion' : 'Open discussion'}
              {c.outdated ? ' · Earlier revision' : ''}
            </Text>
          )}
          {onAction && (
            <View style={styles.row}>
              {capabilities?.actions.includes('reply') &&
                c.kind !== 'review' &&
                (c.threadId || c.kind === 'inline') && (
                  <Action
                    secondary
                    label="Reply"
                    onPress={() => onAction({ action: 'reply', comment: c })}
                  />
                )}
              {capabilities?.actions.includes('resolve') && c.threadId && c.canResolve && (
                <Action
                  secondary
                  label={c.resolved ? 'Reopen discussion' : 'Resolve discussion'}
                  onPress={() => onAction({ action: 'resolve', comment: c })}
                />
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  )
}
