import { useMemo, useState } from 'react'
import WebView from 'react-native-webview'
import { artifactPreviewHtml } from '@dovo/protocol'
import { useTheme } from '../theme'

export function ArtifactWebView({ content, onError }: { content: string; onError: () => void }) {
  const [generation, setGeneration] = useState(0)
  const { mode, colors } = useTheme()
  const source = useMemo(
    () => ({
      html: artifactPreviewHtml(content, {
        mode,
        background: colors.background,
        foreground: colors.text,
        surface: colors.surface,
        border: colors.border,
        accent: colors.accent,
      }),
    }),
    [content, mode, colors],
  )
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
      onContentProcessDidTerminate={() => setGeneration((value) => value + 1)}
      onRenderProcessGone={() => setGeneration((value) => value + 1)}
    />
  )
}
