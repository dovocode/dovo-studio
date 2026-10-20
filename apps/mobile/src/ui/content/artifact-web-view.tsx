import { useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as Crypto from 'expo-crypto'
import WebView from 'react-native-webview'
import {
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  artifactPreviewHtml,
  artifactDownloadMessageSchema,
  artifactDownloadName,
  decodeResult,
} from '@dovo/protocol'
import { useTheme } from '../theme'

export function ArtifactWebView({ content, onError }: { content: string; onError: () => void }) {
  const [generation, setGeneration] = useState(0)
  const [nonce] = useState(() => Crypto.randomUUID())
  const sharing = useRef(false)
  const { mode, colors } = useTheme()
  const source = useMemo(
    () => ({
      html: artifactPreviewHtml(
        content,
        {
          mode,
          background: colors.background,
          foreground: colors.text,
          surface: colors.surface,
          border: colors.border,
          accent: colors.accent,
        },
        { nonce },
      ),
    }),
    [content, mode, colors, nonce],
  )
  const download = async (input: string) => {
    if (sharing.current || input.length > Math.ceil(ARTIFACT_DOWNLOAD_MAX_BYTES / 3) * 4 + 2048)
      return
    let value: unknown
    try {
      value = JSON.parse(input)
    } catch {
      return
    }
    const message = decodeResult(artifactDownloadMessageSchema, value).data
    if (message?.nonce !== nonce) return
    if (message.error) {
      Alert.alert('Could not download file', message.error)
      return
    }
    if (message.data === undefined || !message.name || !message.mime) return
    sharing.current = true
    let file: File | undefined
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('File sharing is unavailable on this device.')
      const bytes = Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0))
      if (bytes.length > ARTIFACT_DOWNLOAD_MAX_BYTES)
        throw new Error('Download exceeds the 20 MB mobile limit.')
      const name = artifactDownloadName(message.name)
      const mime = message.mime.split(';')[0]
      file = new File(Paths.cache, `artifact-${Crypto.randomUUID()}-${name}`)
      await file.write(bytes)
      await Sharing.shareAsync(file.uri, {
        mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream',
        dialogTitle: name,
      })
    } catch (cause) {
      Alert.alert('Could not download file', cause instanceof Error ? cause.message : String(cause))
    } finally {
      sharing.current = false
      if (file?.exists) file.delete()
    }
  }
  return (
    <WebView
      key={generation}
      source={source}
      style={{ flex: 1, backgroundColor: colors.background }}
      originWhitelist={['*']}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      onShouldStartLoadWithRequest={(request) =>
        request.url === 'about:blank' ||
        (!request.isTopFrame && /^(about:|data:|blob:)/.test(request.url))
      }
      onError={onError}
      onMessage={(event) => {
        void download(event.nativeEvent.data)
      }}
      onContentProcessDidTerminate={() => setGeneration((value) => value + 1)}
      onRenderProcessGone={() => setGeneration((value) => value + 1)}
    />
  )
}
