import { appLinkChoices } from './app-link-target'
import { useLinkOrigin, type LinkOrigin } from './link-origin'
import { router } from 'expo-router'
import { useRuntime } from '../../runtime/connection/provider'
import { Choice } from '../controls/choice'
import { Sheet, useSheetNavigation, type SheetHandle } from '../layout/sheet'
import { SafeModal } from '../layout/safe-modal'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { Action } from '../controls/action'
import WebView from 'react-native-webview'
import { Text } from './text'
import { useTheme } from '../theme'

let openPull: ((url: string, origin?: LinkOrigin) => boolean) | undefined
let showInternal: ((url: string) => void) | undefined

export function openAppLink(url: string, external = false, origin?: LinkOrigin): Promise<void> {
  if (external) return Linking.openURL(url)
  if (openPull?.(url, origin)) return Promise.resolve()
  if (!/^https?:\/\//i.test(url)) return Linking.openURL(url)
  return new Promise((resolve, reject) => {
    Alert.alert('Open link', url, [
      {
        text: 'In Dovo',
        onPress: () => {
          if (!showInternal) {
            reject(new Error('The in-app browser is unavailable'))
            return
          }
          showInternal(url)
          resolve()
        },
      },
      {
        text: 'Default browser',
        onPress: () => void Linking.openURL(url).then(resolve, reject),
      },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
    ])
  })
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
  const [choices, setChoices] = useState<ReturnType<typeof appLinkChoices>>([])
  const [selected, setSelected] = useState('')
  const picker = useRef<SheetHandle>(null)
  useEffect(() => {
    const open = (url: string, origin?: LinkOrigin) => {
      const candidates = appLinkChoices(url, overviews, origin)
      if (!candidates.length) return false
      if (candidates.length === 1) router.push(candidates[0].href)
      else {
        setChoices(candidates)
        setSelected('')
      }
      return true
    }
    openPull = open
    return () => {
      if (openPull === open) openPull = undefined
    }
  }, [overviews])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    showInternal = setUrl
    return () => {
      showInternal = undefined
    }
  }, [])
  return (
    <>
      {!!choices.length && (
        <Sheet ref={picker} title="Choose link source" onClose={() => setChoices([])}>
          <Choice
            label="Source"
            value={selected}
            onChange={setSelected}
            items={choices.map((choice, index) => ({ id: String(index), name: choice.label }))}
          />
          <Action
            label="Open"
            disabled={!selected}
            onPress={() => {
              const choice = choices[Number(selected)]
              if (choice) picker.current?.dismiss(() => router.push(choice.href))
            }}
          />
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
