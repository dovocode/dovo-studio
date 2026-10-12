import { useMemo, useState } from 'react'
import WebView from 'react-native-webview'
import { artifactPreviewHtml } from '@dovo/protocol'

export function ArtifactWebView({ content, onError }: { content: string; onError: () => void }) {
  const [generation, setGeneration] = useState(0)
  const source = useMemo(() => ({ html: artifactPreviewHtml(content) }), [content])
  return (
    <WebView
      key={generation}
      source={source}
      style={{ flex: 1, backgroundColor: '#fff' }}
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
      onContentProcessDidTerminate={() => setGeneration((value) => value + 1)}
      onRenderProcessGone={() => setGeneration((value) => value + 1)}
    />
  )
}
