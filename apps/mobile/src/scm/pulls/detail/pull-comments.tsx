import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { pullDiscussionGroups } from '@dovo/protocol'
import { type ComponentRef, useEffect, useRef, type ReactNode } from 'react'
import { pullFragment } from './pull-destination'
import { Markdown } from '../../../ui/content/markdown'
import { Platform, Pressable, View } from 'react-native'
import { Text } from '../../../ui/content/text'
import { pullCommentSignal, type PullComment, type ForgeCapabilities } from '@dovo/protocol'
import type { PullActionTarget } from '../list/pull-actions'
import { Action } from '../../../ui/controls/action'
import { Icon } from '../../../ui/controls/icon'
import { useTheme } from '../../../ui/theme'
import { formatShortDateTime } from '../../../ui/content/format-date'
import { PullCommentLabel } from './pull-status'
function CommentAnchor({
  children,
  url,
  fragment,
  onAnchor,
}: {
  children: ReactNode
  url: string
  fragment?: string
  onAnchor?: (node: ComponentRef<typeof View>) => void
}) {
  const node = useRef<ComponentRef<typeof View>>(null)
  const { colors } = useTheme()
  useEffect(() => {
    if (fragment && pullFragment(url) === fragment && node.current) onAnchor?.(node.current)
  }, [fragment, url, onAnchor])
  return (
    <View
      ref={node}
      collapsable={false}
      onLayout={() => {
        if (fragment && pullFragment(url) === fragment && node.current) onAnchor?.(node.current)
      }}
      style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: colors.border }}
    >
      {children}
    </View>
  )
}
export function PullComments({
  comments,
  onOpen,
  fileBaseURL,
  onAction,
  capabilities,
  fragment,
  onAnchor,
  expanded = false,
}: {
  expanded?: boolean
  comments: PullComment[]
  onOpen: (url: string) => void
  fileBaseURL?: string
  onAction?: (target: PullActionTarget) => void
  fragment?: string
  onAnchor?: (node: ComponentRef<typeof View>) => void
  capabilities?: ForgeCapabilities
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  if (!expanded && comments.length)
    return (
      <View style={{ gap: 12, minWidth: 0 }}>
        {pullDiscussionGroups(comments).map((group) =>
          group.resolved ? (
            <ResolvedDiscussion
              key={group.key}
              comments={group.comments}
              onOpen={onOpen}
              fileBaseURL={fileBaseURL}
              onAction={onAction}
              capabilities={capabilities}
              fragment={fragment}
              onAnchor={onAnchor}
            />
          ) : (
            <PullComments
              key={group.key}
              expanded
              comments={group.comments}
              onOpen={onOpen}
              fileBaseURL={fileBaseURL}
              onAction={onAction}
              capabilities={capabilities}
              fragment={fragment}
              onAnchor={onAnchor}
            />
          ),
        )}
      </View>
    )
  return (
    <View style={{ gap: 12, minWidth: 0 }}>
      {!comments.length && (
        <Text style={styles.muted}>
          <InterfaceText>{'No discussion yet.'}</InterfaceText>
        </Text>
      )}
      {comments.map((c) => (
        <CommentAnchor key={c.id} url={c.url} fragment={fragment} onAnchor={onAnchor}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={uiText("View {value0}'s {value1} on server", {
              value0: c.author,
              value1: pullCommentSignal(c).label,
            })}
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
                {c.date ? formatShortDateTime(c.date) : uiText('Not submitted yet')}
                {c.kind === 'review' && c.commitId
                  ? uiText(' · Reviewed {value0}', { value0: c.commitId.slice(0, 8) })
                  : ''}
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
              {c.line
                ? uiText(' · Line {value0}', { value0: c.line })
                : uiText(' · Previous revision')}
            </Text>
          )}
          {!!c.body.trim() && (
            <Markdown text={c.body} baseURL={c.url} fileBaseURL={fileBaseURL} preserveLineBreaks />
          )}
          {c.resolved !== undefined && (
            <Text style={styles.muted}>
              {c.resolved ? uiText('Resolved discussion') : uiText('Open discussion')}
              {c.outdated ? uiText(' · Earlier revision') : ''}
            </Text>
          )}
          {onAction && (
            <View style={styles.row}>
              {capabilities?.actions.includes('reply') &&
                c.kind !== 'review' &&
                (c.threadId || c.kind === 'inline') && (
                  <Action
                    secondary
                    label={uiText('Reply')}
                    onPress={() => onAction({ action: 'reply', comment: c })}
                  />
                )}
              {capabilities?.actions.includes('resolve') && c.threadId && c.canResolve && (
                <Action
                  secondary
                  label={c.resolved ? uiText('Reopen discussion') : uiText('Resolve discussion')}
                  onPress={() => onAction({ action: 'resolve', comment: c })}
                />
              )}
            </View>
          )}
        </CommentAnchor>
      ))}
    </View>
  )
}

function ResolvedDiscussion(props: Parameters<typeof PullComments>[0]) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const targeted =
    !!props.fragment &&
    props.comments.some((comment) => pullFragment(comment.url) === props.fragment)
  const [open, setOpen] = useState(targeted)
  useEffect(() => {
    if (targeted) setOpen(true)
  }, [props.fragment, targeted])
  const authors = [...new Set(props.comments.map((comment) => comment.author))]
  return (
    <View style={[styles.card, { gap: 8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={uiText('Resolved discussion by {value0}', {
          value0: authors.join(', '),
        })}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <View style={{ flexDirection: 'row' }}>
          {authors.slice(0, 3).map((author) => (
            <View
              key={author}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                marginRight: -4,
              }}
            >
              <Text style={{ fontSize: 10 }}>{author.slice(0, 2).toUpperCase()}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.muted, { flex: 1 }]}>
          <InterfaceText
            values={{
              value0: props.comments[0]?.path ?? uiText('Discussion'),
              value1: props.comments.length,
              value2: props.comments.length === 1 ? uiText('comment') : uiText('comments'),
            }}
          >
            {'Resolved · {value0} · {value1} {value2}'}
          </InterfaceText>
        </Text>
        <Icon name={open ? 'down' : 'next'} size={16} color={colors.muted} />
      </Pressable>
      {open && <PullComments {...props} expanded />}
    </View>
  )
}
