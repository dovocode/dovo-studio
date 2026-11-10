import { usePreviewActive } from '../preview/use-preview-active'
import { useCallback, useState } from 'react'
import { Pressable, View, ActivityIndicator } from 'react-native'
import { clientScopeKey } from '@dovo/client-runtime'
import { pipelineSignal, taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import { openAppLink } from '../../ui/content/open-link'
import { useLinkOrigin } from '../../ui/content/link-origin'

export function TaskPipelineProgress({ taskId, active }: { taskId: string; active: boolean }) {
  const { call, connected, connection } = useRuntime()
  const foreground = usePreviewActive()
  const { colors, styles } = useTheme()
  const origin = useLinkOrigin(taskId)
  const [linkError, setLinkError] = useState('')
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      call('/api/tasks/waiting', input, taskWaitingSchema),
    [call],
  )
  const { data, error } = useTaskWaiting(
    taskId,
    connected,
    read,
    JSON.stringify([clientScopeKey(connection), taskId]),
    active && foreground,
  )
  const pipelines = data?.dependencies.filter((item) => item.kind === 'pipeline') ?? []
  if (!pipelines.length) return null
  return (
    <View accessibilityLabel="Pipeline progress" style={[styles.card, { padding: 16, gap: 12 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>Watching pipelines</Text>
      {pipelines.map((item) => {
        const progress = item.progress
        const measured = progress && progress.total > 0 && !progress.partial
        return (
          <View key={JSON.stringify([item.repositoryId, item.target])} style={{ gap: 4 }}>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                setLinkError('')
                void openAppLink(item.url, false, origin).catch((cause) =>
                  setLinkError(String(cause)),
                )
              }}
            >
              <Text numberOfLines={1} style={styles.text}>
                {item.project} · {item.label}
              </Text>
            </Pressable>
            {!measured && <ActivityIndicator size="small" color={colors.accent} />}
            <Text style={styles.muted}>
              {measured ? `${progress.completed}/${progress.total} jobs · ` : ''}
              {pipelineSignal(item.status).label}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`${item.label} jobs`}
              accessibilityValue={
                measured
                  ? { min: 0, max: progress.total, now: progress.completed }
                  : { text: 'Waiting for job progress' }
              }
              style={{
                height: 4,
                borderRadius: 2,
                overflow: 'hidden',
                backgroundColor: colors.border,
              }}
            >
              {measured && (
                <View
                  style={{
                    height: 4,
                    width: `${(100 * progress.completed) / progress.total}%`,
                    backgroundColor: colors.accent,
                  }}
                />
              )}
            </View>
            {(!connected || error || item.error || item.pausedReason) && (
              <Text style={styles.muted}>
                {!connected
                  ? 'Offline · Last known progress'
                  : error || item.pausedReason || item.error}
              </Text>
            )}
          </View>
        )
      })}
      {!!linkError && <Text style={styles.muted}>{linkError}</Text>}
    </View>
  )
}
