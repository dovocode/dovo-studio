import { memo, useEffect, useRef } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import { decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { Text } from './text'
import { colors, styles } from '../theme'
import html from '../../../assets/mermaid.json'
const response = Schema.Union(
  mutableStruct({ height: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()) }),
  mutableStruct({ error: Schema.String }),
)
export const MermaidDiagram = memo(function MermaidDiagram({ chart }: { chart: string }) {
  const view = useRef<WebView>(null)
  const [ready, setReady] = useApplicationState(false)
  const [height, setHeight] = useApplicationState(160)
  const [error, setError] = useApplicationState('')
  useEffect(() => setError(''), [chart])
  const fail = (message: string) => {
    setReady(false)
    setError(message)
  }
  useEffect(() => {
    if (ready)
      view.current?.injectJavaScript(`window.renderDiagram(${JSON.stringify(chart)});true;`)
  }, [chart, ready])
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}
    >
      {error ? (
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={styles.muted}>{error}</Text>
          <Text selectable style={[styles.text, { fontFamily: 'monospace', fontSize: 13 }]}>
            {chart}
          </Text>
        </View>
      ) : (
        <WebView
          ref={view}
          source={{ html }}
          style={{ height, backgroundColor: 'transparent' }}
          originWhitelist={['*']}
          allowFileAccess={false}
          mixedContentMode="never"
          scrollEnabled={height >= 600}
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
          onLoad={() => setReady(true)}
          onError={() => fail('Could not load diagram. Mermaid source:')}
          onContentProcessDidTerminate={() => {
            setReady(false)
            view.current?.reload()
          }}
          onRenderProcessGone={() => {
            setReady(false)
            view.current?.reload()
          }}
          onMessage={(event) => {
            let value: unknown
            try {
              value = JSON.parse(event.nativeEvent.data)
            } catch {
              return
            }
            const result = decodeResult(response, value)
            if (!result.success) return
            if ('error' in result.data) fail(result.data.error)
            else if (result.data.height > 0)
              setHeight(Math.max(80, Math.min(600, result.data.height)))
          }}
        />
      )}
    </View>
  )
})
