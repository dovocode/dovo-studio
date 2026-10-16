import { linkTargetHref } from './app-link-target'
import {
  resolveLinkTargets,
  linkActions,
  useLinkController,
  type LinkAction as RouterAction,
} from '@dovo/studio-core/links'
import * as Clipboard from 'expo-clipboard'
import { previewUrl } from '@dovo/protocol'
import { useLinkOrigin, type LinkOrigin } from './link-origin'
import { router, usePathname } from 'expo-router'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet, useSheetNavigation, type SheetHandle } from '../layout/sheet'
import { SafeModal } from '../layout/safe-modal'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { Action } from '../controls/action'
import WebView from 'react-native-webview'
import { Text } from './text'
import { useTheme } from '../theme'

export type LinkAction = Omit<RouterAction, 'id' | 'kind'>
let showLink: ((url: string, origin?: LinkOrigin, actions?: LinkAction[]) => void) | undefined

export async function openAppLink(
  url: string,
  external = false,
  origin?: LinkOrigin,
  actions?: LinkAction[],
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    if (!/^(mailto|tel|sms|dovo):/i.test(url)) throw new Error('Unsupported link address')
    return Linking.openURL(url)
  }
  previewUrl(url)
  if (external) return Linking.openURL(url)
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

  const { overviews, activeId } = useRuntime()
  const pathname = usePathname()
  const { controller, pending } = useLinkController()
  useEffect(() => {
    controller.cancel()
  }, [controller, activeId, pathname])
  const picker = useRef<SheetHandle>(null)
  const [url, setUrl] = useState<string | null>(null)
  const owner = useRef(overviews)
  owner.current = overviews
  useEffect(() => {
    const show = (url: string, origin?: LinkOrigin, actions?: LinkAction[]) => {
      controller.open({
        url,
        origin,
        onError: (cause) => Alert.alert('Could not open link', String(cause)),
        actions: linkActions(
          url,
          resolveLinkTargets(url, owner.current, origin),
          {
            details: (target) => router.push(linkTargetHref(target)),
            browser: setUrl,
            external: (target) => Linking.openURL(target),
            copy: (target) => Clipboard.setStringAsync(target),
          },
          actions?.map((action, index) => ({
            ...action,
            id: `thread:${index}`,
            kind: 'thread',
            keepOpen: true,
          })),
        ),
      })
    }
    showLink = show
    return () => {
      if (showLink === show) showLink = undefined
    }
  }, [controller])
  useEffect(() => {
    if (pending?.closing) picker.current?.dismiss()
  }, [pending])
  return (
    <>
      {pending && (
        <Sheet
          ref={picker}
          title="Open link"
          presentation="dialog"
          busy={pending.busy}
          onClose={() => controller.dismissed(pending.request)}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12 }}>
            <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
              {pending.request.url}
            </Text>
          </View>
          {pending.request.actions.map((action) => (
            <Action
              key={action.id}
              label={action.label}
              secondary
              wide
              disabled={pending.busy || action.disabled}
              onPress={() =>
                controller.select(pending.request, action.id, () => picker.current?.dismiss())
              }
            />
          ))}
          {!!pending.error && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.error, fontSize: 14, lineHeight: 20 }}
            >
              {pending.error}
            </Text>
          )}
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
            <Text
              numberOfLines={1}
              style={{ flex: 1, marginLeft: 16, color: colors.text, fontSize: 14, lineHeight: 20 }}
            >
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
