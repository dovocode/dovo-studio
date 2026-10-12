import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
import { SafeModal } from '../layout/safe-modal'
import { ArtifactWebView } from './artifact-web-view'
import { Text } from './text'
import { Action } from '../controls/action'

export function TaskVisualization({
  taskId,
  path,
  label,
}: {
  taskId?: string
  path: string
  label: string
}) {
  const { read, connected } = useRuntime()
  const { styles, colors } = useTheme()
  const [content, setContent] = useState<string>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState(false)
  useEffect(() => {
    let active = true
    setContent(undefined)
    setError('')
    if (!connected || !taskId) return
    void read('/api/tasks/visualizations/read', { taskId, path }, responses.projectFile).then(
      (result) => {
        if (active) setContent(result.contents)
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [read, connected, taskId, path, reload])
  const preview = () =>
    !connected || !taskId ? (
      <Text style={styles.muted}>Reconnect to the computer to load this visualization.</Text>
    ) : error ? (
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={styles.error}>{error}</Text>
        <Action label="Retry visualization" onPress={() => setReload((value) => value + 1)} />
      </View>
    ) : content === undefined ? (
      <ActivityIndicator color={colors.accent} />
    ) : source ? (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text selectable style={styles.text}>
          {content}
        </Text>
      </ScrollView>
    ) : (
      <ArtifactWebView content={content} onError={() => setError('Could not load visualization')} />
    )
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        overflow: 'hidden',
        marginVertical: 8,
      }}
    >
      <View style={{ padding: 10, gap: 8, backgroundColor: colors.surface }}>
        <Text style={styles.text}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Action secondary label="Expand visualization" onPress={() => setExpanded(true)} />
          <Action
            secondary
            label={source ? 'Show preview' : 'View source'}
            onPress={() => setSource((value) => !value)}
          />
        </View>
      </View>
      <View style={{ height: 360 }}>{!expanded && preview()}</View>
      {expanded && (
        <SafeModal visible onRequestClose={() => setExpanded(false)} animationType="slide">
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={styles.text}>{label}</Text>
            <Action secondary label="Close visualization" onPress={() => setExpanded(false)} />
          </View>
          <View style={{ flex: 1 }}>{preview()}</View>
        </SafeModal>
      )}
    </View>
  )
}
