import { router } from 'expo-router'

export function openExtensionPage(runtimeId: string, extensionId: string, pageId: string) {
  router.navigate(
    { pathname: '/settings/studio-extension-page', params: { runtimeId, extensionId, pageId } },
    { withAnchor: true },
  )
}
