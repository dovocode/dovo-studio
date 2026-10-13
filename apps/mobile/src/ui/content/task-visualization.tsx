import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, View, useWindowDimensions } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
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
  const { read, connected, connection } = useRuntime()
  const { styles, colors } = useTheme()
  const { height } = useWindowDimensions()
  const [loaded, setLoaded] = useState<{ key: string; contents: string }>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState(false)
  const key = JSON.stringify([taskId, path, connection?.address, connection?.token, reload])
  const content = loaded?.key === key ? loaded.contents : undefined
  useEffect(() => {
    let active = true
    setError('')
    if (!connected || !taskId || content !== undefined) return
    void read('/api/tasks/visualizations/read', { taskId, path }, responses.projectFile).then(
      (result) => {
        if (active) setLoaded({ key, contents: result.contents })
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [read, connected, taskId, path, key, content])
  const preview = () =>
    (!connected || !taskId) && content === undefined ? (
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
          <Action
            secondary
            label={expanded ? 'Collapse visualization' : 'Expand visualization'}
            onPress={() => setExpanded((value) => !value)}
          />
          <Action
            secondary
            label="Refresh visualization"
            disabled={!connected || !taskId}
            onPress={() => setReload((value) => value + 1)}
          />
          <Action
            secondary
            label={source ? 'Show preview' : 'View source'}
            onPress={() => setSource((value) => !value)}
          />
        </View>
      </View>
      {!connected && content !== undefined && (
        <Text style={styles.muted}>Computer offline · Showing loaded preview</Text>
      )}
      <View style={{ height: expanded ? Math.max(360, height * 0.8) : 360 }}>{preview()}</View>
    </View>
  )
}
