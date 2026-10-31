import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Pressable, View } from 'react-native'
import WebView from 'react-native-webview'
import {
  taskFileShareSchema,
  localMarkdownPath,
  markdownFileName,
  artifactTemplatePrompt,
  type ArtifactTemplate,
  createRuntimeClient,
  parsePdfViewerMessage,
  type PdfViewState,
} from '@dovo/protocol'
import * as Crypto from 'expo-crypto'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
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
  const [opened, setOpened] = useState(previewOnly)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    key: string
    url?: string
    bridgeId?: string
    error?: string
  }>()
  const local = localMarkdownPath(path) !== undefined
  const transportAddress = connection ? createRuntimeClient(connection).url('/') : undefined
  const identity = JSON.stringify([
    taskId,
    path,
    connection?.address,
    connection?.token,
    transportAddress,
  ])
  const key = JSON.stringify([identity, revision])
  const currentKey = useRef(key)
  currentKey.current = key
  const saved = useRef<{ identity: string; state: PdfViewState | null }>({ identity, state: null })
  if (saved.current.identity !== identity) saved.current = { identity, state: null }
  const web = useRef<WebView>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const recovered = useRef<string | null>(null)
  const retry = () => {
    currentKey.current = ''
    recovered.current = null
    setRevision((value) => value + 1)
  }
  const processLost = () => {
    if (!mounted.current || currentKey.current !== key) return
    if (recovered.current !== identity && AppState.currentState !== 'background') {
      recovered.current = identity
      currentKey.current = ''
      setRevision((value) => value + 1)
    } else {
      setResult({ key, error: 'The preview stopped. Retry to open it again.' })
    }
  }
  useEffect(() => {
    if (!local || (!video && !opened) || !taskId || !connected || !connection) return
    let active = true
    void read('/api/tasks/files/share', { taskId, path }, taskFileShareSchema)
      .then((result) => {
        if (active)
          setResult({
            key,
            url: createRuntimeClient(connection).url(result.url),
            bridgeId: Crypto.randomUUID(),
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
  const previewUrl = url && current?.bridgeId ? `${url}#dovo-pdf=${current.bridgeId}` : url
  const sendRestore = () => {
    if (!current?.bridgeId || currentKey.current !== key) return
    const message = {
      channel: 'dovo-pdf',
      id: current.bridgeId,
      type: 'restore',
      state: saved.current.state,
    }
    web.current?.injectJavaScript(`window.postMessage(${JSON.stringify(message)}, '*');true;`)
  }
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
  const preview = previewUrl ? (
    <WebView
      key={key}
      ref={web}
      source={{ uri: previewUrl }}
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
          event.url === previewUrl ||
          (local && event.url === url + '?content=1')
        )
      }}
      onFileDownload={() => launch(true)}
      onLoad={({ nativeEvent }) => {
        if (url && nativeEvent.url.split('#')[0] === url) sendRestore()
      }}
      onMessage={({ nativeEvent }) => {
        if (
          !current?.bridgeId ||
          !url ||
          currentKey.current !== key ||
          nativeEvent.url.split('#')[0] !== url ||
          nativeEvent.data.length > 2048
        )
          return
        let value: unknown
        try {
          value = JSON.parse(nativeEvent.data)
        } catch {
          return
        }
        const message = parsePdfViewerMessage(value, current.bridgeId)
        if (message?.type === 'ready') sendRestore()
        else if (message?.type === 'state') saved.current.state = message.state
      }}
      onContentProcessDidTerminate={processLost}
      onRenderProcessGone={processLost}
      onError={({ nativeEvent }) => {
        if (mounted.current && currentKey.current === key)
          setResult({ key, error: nativeEvent.description })
      }}
    />
  ) : null
  const status = error ? (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>{error}</Text>
      <Action label="Retry preview" secondary onPress={retry} />
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
                onPress={retry}
              />
            )}
            <Action
              label="Open preview in browser"
              secondary
              disabled={!url}
              onPress={() => launch(false)}
            />
            <Action label="Download original" disabled={!url} onPress={() => launch(true)} />
          </View>
        </Sheet>
      )}
    </View>
  )
}
