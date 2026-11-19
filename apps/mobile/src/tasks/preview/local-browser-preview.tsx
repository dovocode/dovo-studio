import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { AppState, useWindowDimensions } from 'react-native'
import { WebView } from 'react-native-webview'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'

export function LocalBrowserPreview({
  page,
  ticket,
  onClose,
}: {
  page: string
  ticket: () => Promise<string>
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const { height } = useWindowDimensions()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const latestTicket = useRef(ticket)
  latestTicket.current = ticket
  useEffect(() => {
    const abort = new AbortController()
    const report = (cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        abort.abort()
        setUrl('')
        setError('The app went to the background. Reopen the preview to continue.')
      }
    })
    setUrl('')
    setError('')
    void import('./local-browser-tunnel')
      .then(({ openLocalBrowserTunnel }) =>
        openLocalBrowserTunnel(page, () => latestTicket.current(), abort.signal, report),
      )
      .then((result) => {
        if (!abort.signal.aborted) setUrl(result.url)
      }, report)
    return () => {
      abort.abort()
      subscription.remove()
    }
  }, [page, attempt])
  const origin = url ? new URL(url).origin : undefined
  return (
    <Sheet title={uiText('Local preview')} onClose={onClose} scrollable={false}>
      <Text selectable>{page}</Text>
      {error ? (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Action label={uiText('Retry')} onPress={() => setAttempt((value) => value + 1)} />
        </>
      ) : url ? (
        <WebView
          source={{ uri: url }}
          style={{ height: Math.max(180, height * 0.56) }}
          incognito
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          originWhitelist={['http://*', 'https://*', 'about:blank']}
          onShouldStartLoadWithRequest={(request) => {
            try {
              return request.url === 'about:blank' || new URL(request.url).origin === origin
            } catch {
              return false
            }
          }}
          onError={({ nativeEvent }) => setError(nativeEvent.description)}
        />
      ) : (
        <Text>{uiText('Opening preview…')}</Text>
      )}
    </Sheet>
  )
}
