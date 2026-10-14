import { useCallback, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { openAppLink } from '../../ui/content/open-link'
import { useTheme } from '../../ui/theme'

export function TaskWaitingPanel({ taskId }: { taskId: string }) {
  const { call, connected } = useRuntime()
  const { styles, colors } = useTheme()
  const [linkError, setLinkError] = useState('')
  const open = (url: string) => {
    setLinkError('')
    void openAppLink(url).catch((cause) => setLinkError(String(cause)))
  }
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      call('/api/tasks/waiting', input, taskWaitingSchema),
    [call],
  )
  const { data, error, busy, refresh } = useTaskWaiting(taskId, connected, read)
  const watchingUrls = new Set(data?.dependencies.map((item) => item.url))
  const related = data?.related?.filter((item) => !watchingUrls.has(item.url)) ?? []
  if (!error && !linkError && !data?.dependencies.length && !related.length) return null
  return (
    <View
      accessibilityLabel="Related items and watchers"
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 6,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {!connected && <Text style={styles.muted}>Connect the runtime to manage waiting items.</Text>}
      {linkError && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {linkError}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {!!related.length && (
        <Text style={[styles.muted, { width: '100%' }]}>Related to this thread</Text>
      )}
      {related.map((item) => (
        <Pressable
          key={item.url}
          accessibilityRole="link"
          accessibilityLabel={`Open ${item.label}`}
          onPress={() => open(item.url)}
          style={{
            borderWidth: 1,
            borderColor: colors.muted,
            borderRadius: 24,
            maxWidth: '100%',
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text numberOfLines={1} style={styles.text}>
            {item.project} · {item.label}
          </Text>
        </Pressable>
      ))}
      {!!data?.dependencies.length && (
        <Text style={[styles.muted, { width: '100%' }]}>
          Watching · Dovo monitors these for updates
        </Text>
      )}
      {data?.dependencies.map((item) => (
        <View
          key={JSON.stringify([item.kind, item.repositoryId, item.target])}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.muted,
            borderRadius: 24,
            maxWidth: '100%',
          }}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.label}${item.pausedReason ? `, ${item.pausedReason}` : ''}`}
            onPress={() => open(item.url)}
            style={{
              flexShrink: 1,
              paddingLeft: 12,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="preview" size={16} color={colors.muted} />
            <Text numberOfLines={1} style={styles.text}>
              {item.project} · {item.label}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop watching ${item.label}`}
            disabled={!connected || busy}
            style={{ padding: 12, opacity: busy || !connected ? 0.4 : 1 }}
            onPress={() =>
              Alert.alert(
                `Stop watching ${item.label}?`,
                'This stops monitoring this item for this thread.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Stop watching',
                    style: 'destructive',
                    onPress: () =>
                      void refresh({
                        kind: item.kind,
                        repositoryId: item.repositoryId,
                        target: item.target,
                      }),
                  },
                ],
              )
            }
          >
            <Icon name="close" size={12} color={colors.muted} />
          </Pressable>
          {item.pausedReason && (
            <Text accessibilityLabel={item.pausedReason} style={styles.muted}>
              Paused
            </Text>
          )}
          {item.error && <Text style={{ color: colors.error }}>{item.error}</Text>}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh waiting items"
        disabled={!connected || busy}
        onPress={() => void refresh()}
        style={{ padding: 10 }}
      >
        <Text style={styles.muted}>↻</Text>
      </Pressable>
    </View>
  )
}
