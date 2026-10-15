import { appLinkChoices } from './app-link-target'
import { useLinkOrigin, type LinkOrigin } from './link-origin'
import { router } from 'expo-router'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet, useSheetNavigation, type SheetHandle } from '../layout/sheet'
import { SafeModal } from '../layout/safe-modal'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { Action } from '../controls/action'
import WebView from 'react-native-webview'
import { Text } from './text'
import { useTheme } from '../theme'

export type LinkAction = {
  label: string
  disabled?: boolean
  signal?: AbortSignal
  run: () => Promise<unknown>
}
let showLink: ((url: string, origin?: LinkOrigin, actions?: LinkAction[]) => void) | undefined

export async function openAppLink(
  url: string,
  external = false,
  origin?: LinkOrigin,
  actions?: LinkAction[],
): Promise<void> {
  if (external || !/^https?:\/\//i.test(url)) return Linking.openURL(url)
  if (!showLink) throw new Error('The link chooser is unavailable')
  showLink(url, origin, actions)
}

/** Capture the rendering owner and wait for containing native sheets before navigation. */
export function useOpenAppLink(taskId?: string, repositoryId?: string, jiraSourceId?: string) {
  const origin = useLinkOrigin(taskId, repositoryId, jiraSourceId)
  const navigateAfterSheet = useSheetNavigation()
  return useCallback(
    (url: string, external = false) =>
      new Promise<void>((resolve, reject) => {
        navigateAfterSheet(() => {
          void openAppLink(url, external, origin).then(resolve, reject)
        })
      }),
    [origin.runtimeId, origin.repositoryId, origin.jiraSourceId, navigateAfterSheet],
  )
}

export function LinkBrowser() {
  const { colors } = useTheme()

  const { overviews } = useRuntime()
  const [pending, setPending] = useState<{
    url: string
    origin?: LinkOrigin
    actions?: LinkAction[]
  } | null>(null)
  const picker = useRef<SheetHandle>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choices = pending ? appLinkChoices(pending.url, overviews, pending.origin) : []
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const show = (url: string, origin?: LinkOrigin, actions?: LinkAction[]) => {
      setBusy(false)
      setError('')
      setPending({ url, origin, actions })
    }
    showLink = show
    return () => {
      if (showLink === show) showLink = undefined
    }
  }, [])
  useEffect(() => {
    if (!pending) return
    const signals =
      pending.actions?.flatMap((action) => (action.signal ? [action.signal] : [])) ?? []
    const cancel = () => setPending((current) => (current === pending ? null : current))
    if (signals.some((signal) => signal.aborted)) cancel()
    for (const signal of signals) signal.addEventListener('abort', cancel, { once: true })
    return () => {
      for (const signal of signals) signal.removeEventListener('abort', cancel)
    }
  }, [pending])
  return (
    <>
      {pending && (
        <Sheet ref={picker} title="Open link" busy={busy} onClose={() => setPending(null)}>
          <Text numberOfLines={3}>{pending.url}</Text>
          {choices.map((choice, index) => (
            <Action
              key={`${choice.runtimeId}:${index}`}
              secondary
              label={`${choice.href.pathname.includes('/pulls/pr/') ? 'Open PR details' : choice.href.pathname.includes('/pulls/pipeline/') ? 'Open pipeline details' : 'Open issue details'}${choices.length > 1 ? ` · ${choice.label}` : ''}`}
              onPress={() => picker.current?.dismiss(() => router.push(choice.href))}
            />
          ))}
          <Action
            label="Open in Dovo browser"
            secondary
            onPress={() => {
              const target = pending.url
              picker.current?.dismiss(() => setUrl(target))
            }}
          />
          <Action
            label="Open in external browser"
            secondary
            onPress={() => {
              const target = pending.url
              picker.current?.dismiss(() => {
                void Linking.openURL(target).catch((cause: unknown) =>
                  Alert.alert('Could not open link', String(cause)),
                )
              })
            }}
          />
          {pending.actions?.map((action) => (
            <Action
              key={action.label}
              label={action.label}
              disabled={busy || action.disabled}
              onPress={() => {
                if (action.signal?.aborted) return
                setBusy(true)
                setError('')
                void action
                  .run()
                  .then(() => {
                    if (!action.signal?.aborted) picker.current?.dismiss()
                  })
                  .catch((cause: unknown) => {
                    if (!action.signal?.aborted) setError(String(cause))
                  })
                  .finally(() => {
                    if (!action.signal?.aborted) setBusy(false)
                  })
              }}
            />
          ))}
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
        </Sheet>
      )}
      <SafeModal visible={url !== null} animationType="slide" onRequestClose={() => setUrl(null)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
            }}
          >
            <Action label="Close" secondary onPress={() => setUrl(null)} />
            <Text numberOfLines={1} style={{ flex: 1, marginLeft: 16 }}>
              {url}
            </Text>
          </View>
          {url && (
            <WebView
              source={{ uri: url }}
              originWhitelist={['http://*', 'https://*']}
              onShouldStartLoadWithRequest={(request) => /^https?:\/\//i.test(request.url)}
            />
          )}
        </View>
      </SafeModal>
    </>
  )
}
