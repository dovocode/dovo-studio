import { useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import WebView from 'react-native-webview'
import {
  taskFileShareSchema,
  localMarkdownPath,
  markdownFileName,
  artifactTemplatePrompt,
  type ArtifactTemplate,
  responses,
  repositoryOpenTargets,
  createRuntimeClient,
  isRepositoryOpenTarget,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
import { useAction } from '../controls/use-action'
import { Action } from '../controls/action'
import { Text } from './text'
import { MobileFileTypeIcon } from './file-tree'
import { Sheet } from '../layout/sheet'
import { openAppLink } from './open-link'
import * as Clipboard from 'expo-clipboard'

export function TemplateCard({
  template,
  onUse,
}: {
  template: ArtifactTemplate
  onUse?: (prompt: string) => void
}) {
  const { colors, styles } = useTheme()
  return (
    <View
      accessibilityLabel={`${template.name} template`}
      style={{ padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8 }}
    >
      <Text>{template.name}</Text>
      <Text style={styles.muted}>{template.kind.replaceAll('-', ' ')} template</Text>
      <Action
        label={onUse ? 'Use template' : 'Copy template prompt'}
        onPress={() => {
          const prompt = artifactTemplatePrompt(template)
          if (onUse) onUse(prompt)
          else
            void Clipboard.setStringAsync(prompt).catch((error: unknown) =>
              Alert.alert('Could not copy prompt', String(error)),
            )
        }}
      />
    </View>
  )
}
/** The file grant resolves on its owning runtime, never on the phone's filesystem. */
export function RichFile({
  taskId,
  path,
  label,
  video = false,
  previewOnly = false,
  onClose,
}: {
  taskId?: string
  path: string
  label: string
  video?: boolean
  previewOnly?: boolean
  onClose?: () => void
}) {
  const { read, connected, connection } = useRuntime()
  const { colors, styles } = useTheme()
  const action = useAction()
  const [applications, setApplications] = useState<Array<{ target: string; name: string }> | null>(
    null,
  )
  const [opened, setOpened] = useState(previewOnly)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; url?: string; error?: string }>()
  const local = localMarkdownPath(path) !== undefined
  const transportAddress = connection ? createRuntimeClient(connection).url('/') : undefined
  const key = JSON.stringify([
    taskId,
    path,
    connection?.address,
    connection?.token,
    transportAddress,
    revision,
  ])
  useEffect(() => {
    if (!local || (!video && !opened) || !taskId || !connected || !connection) return
    let active = true
    void read('/api/tasks/files/share', { taskId, path }, taskFileShareSchema)
      .then((result) => {
        if (active)
          setResult({
            key,
            url: createRuntimeClient(connection).url(result.url),
          })
      })
      .catch((error: unknown) => {
        if (active) setResult({ key, error: String(error) })
      })
    return () => {
      active = false
    }
  }, [local, video, opened, taskId, path, read, connected, connection, key, revision])
  const current = result?.key === key ? result : undefined
  const url = local ? current?.url : path
  const error =
    local && (!connected || !taskId)
      ? 'Connect to the file’s computer to preview it.'
      : current?.error
  const launch = (download: boolean) => {
    if (url)
      void openAppLink(url + (local && download ? '?download=1' : ''), true).catch(
        (cause: unknown) => Alert.alert('Could not open file', String(cause)),
      )
  }
  // Only the trusted capability page runs scripts; file HTML/SVG stays sandboxed.
  const preview = url ? (
    <WebView
      source={{ uri: url }}
      style={{ height: video && !opened ? 260 : 480, backgroundColor: colors.surface }}
      javaScriptEnabled={local}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      originWhitelist={['http://*', 'https://*']}
      onShouldStartLoadWithRequest={(event) => {
        if (local && event.url === url + '?download=1') {
          launch(true)
          return false
        }
        return (
          (!local && /^https?:\/\//i.test(event.url)) ||
          event.url === 'about:blank' ||
          event.url === url ||
          (local && event.url === url + '?content=1')
        )
      }}
      onFileDownload={() => launch(true)}
      onError={({ nativeEvent }) => setResult({ key, error: nativeEvent.description })}
    />
  ) : null
  const status = error ? (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>{error}</Text>
      <Action label="Retry preview" secondary onPress={() => setRevision((value) => value + 1)} />
    </View>
  ) : !url ? (
    <Text style={styles.muted}>Loading preview…</Text>
  ) : null
  return (
    <View style={{ gap: 8 }}>
      {!previewOnly && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Preview ${label}`}
          onPress={() => setOpened(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
          }}
        >
          <MobileFileTypeIcon path={path} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1}>{label}</Text>
            <Text numberOfLines={1} style={styles.muted}>
              {markdownFileName(path)} · Preview
            </Text>
          </View>
        </Pressable>
      )}
      {video && !opened && (status || preview)}
      {opened && (
        <Sheet
          title={label}
          onClose={() => {
            setOpened(false)
            onClose?.()
          }}
        >
          <View style={{ gap: 12 }}>
            {status || preview}
            {local && (
              <Action
                label="Refresh preview"
                secondary
                disabled={!connected || !taskId || (!url && !error)}
                onPress={() => setRevision((value) => value + 1)}
              />
            )}
            {!!action.error && <Text style={styles.muted}>{action.error}</Text>}
            <Action
              label="Open preview in browser"
              secondary
              disabled={!url}
              onPress={() => launch(false)}
            />
            <Action label="Download original" disabled={!url} onPress={() => launch(true)} />
            {local && (
              <Action
                label="Open on runtime computer…"
                secondary
                disabled={!connected || action.busy}
                onPress={() =>
                  action.act(async () => {
                    const { targets } = await read(
                      '/api/scm/open-targets',
                      {},
                      responses.repositoryOpenTargets,
                    )
                    const folder = targets.includes('explorer')
                      ? 'explorer'
                      : targets.includes('file-manager')
                        ? 'file-manager'
                        : 'finder'
                    setApplications(
                      repositoryOpenTargets(folder)
                        .filter(([target]) => targets.includes(target))
                        .map(([target, name]) => ({ target, name })),
                    )
                  })
                }
              />
            )}
            {applications && (
              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>Applications on the runtime computer</Text>
                {!applications.length && (
                  <Text style={styles.muted}>
                    No supported applications found on the runtime computer.
                  </Text>
                )}
                {applications.map(({ target, name }) => (
                  <Action
                    key={target}
                    label={`Open in ${name}`}
                    secondary
                    disabled={action.busy}
                    onPress={() =>
                      action.act(async () => {
                        if (!taskId || !isRepositoryOpenTarget(target)) return
                        await read('/api/tasks/files/open', { taskId, path, target }, responses.ok)
                      })
                    }
                  />
                ))}
              </View>
            )}
          </View>
        </Sheet>
      )}
    </View>
  )
}
