import { useApplicationState } from '../runtime/application-state'
import { View, useWindowDimensions } from 'react-native'
import { Text } from '../ui/text'
import { pullFilePatch, type PullDetail } from '@dovo/protocol'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { colors, styles } from '../ui/theme'
import { DiffView } from '../tasks/diff-view'
import { PullComments } from './pull-comments'
import type { PullActionTarget } from './pull-actions'
export function PullChanges({
  detail,
  onOpen,
  onAction,
  onLineComment,
}: {
  detail: PullDetail
  onOpen: (url: string) => void
  onAction?: (target: PullActionTarget) => void
  onLineComment?: (path: string) => void
}) {
  const { height } = useWindowDimensions()
  const [selected, setSelected] = useApplicationState(detail.files[0]?.path ?? ''),
    [viewed, setViewed] = useApplicationState<Set<string>>(new Set())
  const file = detail.files.find((f) => f.path === selected) ?? detail.files[0]
  if (!file) return <Text style={styles.muted}>No changed files returned.</Text>
  return (
    <View
      style={{
        gap: 10,
      }}
    >
      <View
        style={[
          styles.row,
          {
            justifyContent: 'space-between',
            rowGap: 10,
          },
        ]}
      >
        <Text
          style={[
            styles.muted,
            {
              minWidth: 0,
              flexShrink: 1,
            },
          ]}
        >
          {viewed.size} of {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}{' '}
          viewed
        </Text>
        <Action
          secondary
          label={viewed.has(file.path) ? 'Viewed ✓' : 'Mark viewed'}
          onPress={() =>
            setViewed((current) => {
              const next = new Set(current)
              if (next.has(file.path)) next.delete(file.path)
              else next.add(file.path)
              return next
            })
          }
        />
      </View>
      <Choice
        label="Changed file"
        hideLabel
        value={file.path}
        onChange={setSelected}
        items={detail.files.map((entry) => {
          const parts = entry.path.split('/')
          const name = parts.pop() ?? entry.path
          return {
            id: entry.path,
            name: `${name}${parts.length ? ` · ${parts.join('/')}` : ''}`,
          }
        })}
      />
      <Text selectable style={styles.muted}>
        {file.previousPath ? `Renamed from ${file.previousPath} · ` : ''}
        <Text
          style={{
            color: '#8ad5b0',
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
          <DiffView patch={pullFilePatch(file)} />
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
