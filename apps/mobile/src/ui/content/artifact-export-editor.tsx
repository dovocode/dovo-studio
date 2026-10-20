import { useMemo, useState } from 'react'
import WebView from 'react-native-webview'
import * as Crypto from 'expo-crypto'
import {
  artifactExportEditorHtml,
  artifactExportEditMessageSchema,
  decodeResult,
  type ArtifactExportEdit,
} from '@dovo/protocol'
import { SafeModal } from '../layout/safe-modal'

export function ArtifactExportEditor({
  content,
  onAction,
}: {
  content: string
  onAction: (edit: ArtifactExportEdit) => void
}) {
  const [nonce] = useState(() => Crypto.randomUUID())
  const source = useMemo(
    () => ({ html: artifactExportEditorHtml(content, nonce) }),
    [content, nonce],
  )
  return (
    <SafeModal animationType="slide" onRequestClose={() => onAction({ action: 'cancel' })}>
      <WebView
        source={source}
        style={{ flex: 1 }}
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
        onError={() => onAction({ action: 'cancel' })}
        onContentProcessDidTerminate={() => onAction({ action: 'cancel' })}
        onRenderProcessGone={() => onAction({ action: 'cancel' })}
        onMessage={(event) => {
          let input: unknown
          try {
            input = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }
          const message = decodeResult(artifactExportEditMessageSchema, input).data
          if (message?.nonce !== nonce) return
          if (message.action === 'cancel') onAction({ action: 'cancel' })
          else if (message.content !== undefined)
            onAction({ action: 'apply', content: message.content })
        }}
      />
    </SafeModal>
  )
}
